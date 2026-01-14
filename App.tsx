import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Play, 
  Download, 
  Database, 
  BrainCircuit, 
  FileCode,
  AlertCircle,
  Timer,
  Upload,
  Trash2,
  RefreshCw,
  Settings2,
  CloudLightning,
  Key,
  X,
  CheckCircle2,
  HelpCircle,
  Shield,
  CreditCard,
  Edit3
} from 'lucide-react';
import { parseSitemap, scrapeContent } from './services/crawler';
import { classifyPageContent } from './services/gemini';
import { classifyWithBedrock, AwsConfig } from './services/bedrock';
import { Dashboard } from './components/Dashboard';
import { ProcessList } from './components/ProcessList';
import { AppState, ProcessingStatus, ClassifiedPage } from './types';

// Example Sitemap for Testing
const EXAMPLE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.encephalitis.info/what-is-encephalitis</loc>
  </url>
  <url>
    <loc>https://www.encephalitis.info/types-of-encephalitis/autoimmune-encephalitis</loc>
  </url>
   <url>
    <loc>https://www.encephalitis.info/recovery/rehabilitation</loc>
  </url>
  <url>
    <loc>https://www.encephalitis.info/news/chickenpox-vaccines-for-children-start-across-uk/</loc>
  </url>
</urlset>`;

const formatTime = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return 'Calculating...';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const STORAGE_KEY = 'encephalitis_classifier_session_v1';
const PROVIDER_KEY = 'encephalitis_classifier_provider';
// Bump version to reset config for new model options and region fix
const AWS_CONFIG_KEY = 'encephalitis_classifier_aws_config_v8';

type AiProvider = 'gemini' | 'bedrock';

export default function App() {
  const [sitemapInput, setSitemapInput] = useState<string>('');
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [queue, setQueue] = useState<ProcessingStatus[]>([]);
  const [results, setResults] = useState<ClassifiedPage[]>([]);
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState<string>('');
  const [provider, setProvider] = useState<AiProvider>('gemini');
  
  // AWS Configuration State
  const [showAwsModal, setShowAwsModal] = useState(false);
  const [awsConfig, setAwsConfig] = useState<AwsConfig>({
    authType: 'standard',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: '',
    apiKey: '',
    region: 'us-east-1', 
    modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0'
  });
  
  // State to handle custom model input
  const [isCustomModel, setIsCustomModel] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isRunning = useRef(false);

  // Load session from local storage on mount
  useEffect(() => {
    try {
      const savedSession = localStorage.getItem(STORAGE_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed.sitemapInput) setSitemapInput(parsed.sitemapInput);
        if (parsed.results) setResults(parsed.results);
      }
      
      const savedProvider = localStorage.getItem(PROVIDER_KEY) as AiProvider;
      if (savedProvider) setProvider(savedProvider);

      const savedAwsConfig = localStorage.getItem(AWS_CONFIG_KEY);
      if (savedAwsConfig) {
        const config = JSON.parse(savedAwsConfig);
        setAwsConfig(config);
        // If the loaded model isn't in our standard list, show custom input
        const standardModels = [
          'global.anthropic.claude-haiku-4-5-20251001-v1:0',
          'us.anthropic.claude-3-5-haiku-20241022-v1:0',
          'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
          'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
          'us.anthropic.claude-3-haiku-20240307-v1:0'
        ];
        if (config.modelId && !standardModels.includes(config.modelId)) {
          setIsCustomModel(true);
        }
      }
    } catch (e) {
      console.error("Failed to load session", e);
    }
  }, []);

  // Save session to local storage on changes
  useEffect(() => {
    if (appState !== AppState.PROCESSING) {
      const sessionData = {
        sitemapInput,
        results
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
    }
  }, [sitemapInput, results, appState]);

  const toggleProvider = () => {
    const newProvider = provider === 'gemini' ? 'bedrock' : 'gemini';
    setProvider(newProvider);
    localStorage.setItem(PROVIDER_KEY, newProvider);
    
    // Auto-open modal if switching to Bedrock without valid config
    if (newProvider === 'bedrock') {
      const hasStandard = awsConfig.accessKeyId && awsConfig.secretAccessKey;
      const hasApi = awsConfig.apiKey;
      if (!hasStandard && !hasApi) {
        setShowAwsModal(true);
      }
    }
  };

  const saveAwsConfig = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem(AWS_CONFIG_KEY, JSON.stringify(awsConfig));
    setShowAwsModal(false);
  };

  const handleStart = async () => {
    if (provider === 'bedrock') {
      const hasStandard = awsConfig.accessKeyId && awsConfig.secretAccessKey;
      const hasApi = awsConfig.apiKey;
      if ((awsConfig.authType === 'standard' && !hasStandard) || (awsConfig.authType === 'apikey' && !hasApi)) {
        setShowAwsModal(true);
        return;
      }
    }

    if (!sitemapInput.trim()) {
      alert("Please paste a valid Sitemap XML.");
      return;
    }

    try {
      const urls = parseSitemap(sitemapInput);
      if (urls.length === 0) {
        alert("No valid <loc> URLs found. If you pasted from a browser view, try removing the header text, or ensure <loc> tags are present.");
        return;
      }

      // Map existing results for quick lookup
      const resultsMap = new Map<string, ClassifiedPage>(
        results.map(r => [r.url, r] as [string, ClassifiedPage])
      );

      // Initialize Queue - Merging existing results
      const initialQueue: ProcessingStatus[] = urls.map(url => {
        const existing = resultsMap.get(url);
        if (existing) {
          return { url, status: 'completed', data: existing };
        }
        return { url, status: 'pending' };
      });

      const pendingCount = initialQueue.filter(i => i.status === 'pending').length;
      const completedCount = initialQueue.length - pendingCount;
      const initialProgress = initialQueue.length > 0 
        ? (completedCount / initialQueue.length) * 100 
        : 0;

      setQueue(initialQueue);
      
      if (pendingCount === 0) {
        alert("All URLs in the sitemap have already been processed!");
        setAppState(AppState.COMPLETED);
        setProgress(100);
        return;
      }

      setAppState(AppState.PROCESSING);
      setProgress(initialProgress);
      setEta('Calculating...');
      isRunning.current = true;

      await processQueue(initialQueue);
      
      setAppState(AppState.COMPLETED);
      setEta('');
      isRunning.current = false;

    } catch (e) {
      console.error(e);
      alert("Failed to parse Sitemap XML.");
      setAppState(AppState.IDLE);
    }
  };

  const processQueue = async (items: ProcessingStatus[]) => {
    const currentItems = [...items];
    const sessionStartTime = Date.now();
    let sessionProcessedCount = 0;

    for (let i = 0; i < currentItems.length; i++) {
      if (!isRunning.current) break;

      if (currentItems[i].status === 'completed') {
        continue;
      }

      setQueue(prev => {
        const newQ = [...prev];
        newQ[i] = { ...newQ[i], status: 'scraping' };
        return newQ;
      });

      try {
        const text = await scrapeContent(currentItems[i].url);
        
        setQueue(prev => {
          const newQ = [...prev];
          newQ[i] = { ...newQ[i], status: 'classifying' };
          return newQ;
        });

        // Use selected provider
        let classifiedData;
        if (provider === 'bedrock') {
          classifiedData = await classifyWithBedrock(currentItems[i].url, text, awsConfig);
        } else {
          classifiedData = await classifyPageContent(currentItems[i].url, text);
        }
        
        setResults(prev => {
          if (prev.some(p => p.url === classifiedData.url)) return prev;
          return [...prev, classifiedData];
        });
        
        setQueue(prev => {
          const newQ = [...prev];
          newQ[i] = { ...newQ[i], status: 'completed', data: classifiedData };
          return newQ;
        });

      } catch (err) {
        console.error(`Error processing ${currentItems[i].url}`, err);
        setQueue(prev => {
          const newQ = [...prev];
          newQ[i] = { ...newQ[i], status: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
          return newQ;
        });
      }

      sessionProcessedCount++;

      // Calculate ETA
      const now = Date.now();
      const elapsed = now - sessionStartTime;
      const averageTimePerItem = elapsed / sessionProcessedCount;
      let remainingCount = 0;
      for(let j = i + 1; j < currentItems.length; j++) {
        if (currentItems[j].status !== 'completed') remainingCount++;
      }
      const estimatedRemainingMs = averageTimePerItem * remainingCount;
      setEta(formatTime(estimatedRemainingMs));
      
      setProgress(((i + 1) / currentItems.length) * 100);
      
      // Delay (shorter for Bedrock as it has higher default quotas)
      const delay = provider === 'bedrock' ? 500 : 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  };

  const downloadJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(results, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "encephalitis_content_database.json");
    document.body.appendChild(downloadAnchorNode); 
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const loadExample = () => {
    setSitemapInput(EXAMPLE_SITEMAP);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          const valid = parsed.every(item => item.url && item.title && item.tags);
          if (valid) {
            setResults(parsed as ClassifiedPage[]);
            alert(`Successfully loaded ${parsed.length} records. Click 'Resume Process' to continue.`);
          } else {
            alert("Invalid JSON format. Expected an array of ClassifiedPage objects.");
          }
        } else {
          alert("Invalid JSON format. Expected an array.");
        }
      } catch (err) {
        console.error(err);
        alert("Failed to parse JSON file.");
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const clearSession = () => {
    if (confirm("Are you sure you want to clear all data and start over?")) {
      setSitemapInput('');
      setResults([]);
      setQueue([]);
      setAppState(AppState.IDLE);
      setProgress(0);
      setEta('');
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept=".json" 
        className="hidden" 
      />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg text-white transition-colors ${provider === 'bedrock' ? 'bg-orange-500' : 'bg-blue-600'}`}>
              <BrainCircuit size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Encephalitis Content Classifier</h1>
              <p className="text-xs text-slate-500 font-medium">AI Data Engineer Agent</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <button 
                onClick={toggleProvider}
                disabled={appState === AppState.PROCESSING}
                className="flex items-center gap-2 px-3 py-1.5 rounded-l-full bg-slate-100 hover:bg-slate-200 transition-colors border border-slate-200 border-r-0"
                title="Switch AI Provider"
              >
                {provider === 'gemini' ? (
                  <>
                    <Settings2 size={14} className="text-blue-600" />
                    <span className="text-xs font-semibold text-slate-700">Gemini</span>
                  </>
                ) : (
                  <>
                    <CloudLightning size={14} className="text-orange-500" />
                    <span className="text-xs font-semibold text-slate-700">AWS Bedrock</span>
                  </>
                )}
              </button>
              {provider === 'bedrock' && (
                <button
                  onClick={() => setShowAwsModal(true)}
                  className={`px-3 py-1.5 rounded-r-full border transition-colors border-l-0 -ml-2 
                    ${(!awsConfig.accessKeyId && !awsConfig.apiKey) ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100' : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'}`}
                  title="Configure AWS Keys"
                >
                  <Key size={14} />
                </button>
              )}
            </div>
             <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-400">Model</p>
              <p className="text-sm font-semibold text-slate-700">
                {provider === 'gemini' ? 'Gemini 3 Flash' : (
                   isCustomModel ? 'Custom Bedrock' : (
                    awsConfig.modelId?.includes('global.anthropic.claude-haiku-4-5') ? 'Claude Haiku 4.5 (Global)' :
                    awsConfig.modelId?.includes('claude-3-5-haiku') ? 'Claude 3.5 Haiku (US)' :
                    awsConfig.modelId?.includes('claude-3-5-sonnet') ? 'Claude 3.5 Sonnet (US)' :
                    awsConfig.modelId?.includes('claude-3-haiku') ? 'Claude 3 Haiku (US)' :
                    'Claude 3 Series'
                   )
                )}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* AWS Config Modal */}
      {showAwsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-orange-500 px-6 py-4 flex justify-between items-center text-white">
              <div className="flex items-center gap-2">
                <CloudLightning className="fill-white/20" />
                <h3 className="font-bold text-lg">Connect to AWS Bedrock</h3>
              </div>
              <button onClick={() => setShowAwsModal(false)} className="hover:bg-white/20 p-1 rounded transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={saveAwsConfig} className="p-6">
              
              {/* Tabs */}
              <div className="flex border-b border-slate-200 mb-6">
                <button
                   type="button"
                   className={`flex-1 pb-3 text-sm font-medium border-b-2 transition-colors ${awsConfig.authType === 'standard' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                   onClick={() => setAwsConfig({...awsConfig, authType: 'standard'})}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Shield size={16} /> Standard IAM
                  </div>
                </button>
                <button
                   type="button"
                   className={`flex-1 pb-3 text-sm font-medium border-b-2 transition-colors ${awsConfig.authType === 'apikey' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                   onClick={() => setAwsConfig({...awsConfig, authType: 'apikey'})}
                >
                  <div className="flex items-center justify-center gap-2">
                    <CreditCard size={16} /> Hackathon API Key
                  </div>
                </button>
              </div>

              <div className="space-y-4">
                {awsConfig.authType === 'apikey' ? (
                   <div className="space-y-4 animate-in fade-in duration-300">
                      <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 text-xs text-orange-800 flex gap-2">
                        <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>
                          Enter your credential string. Supports:
                          <ul className="list-disc pl-4 mt-1 space-y-1">
                             <li>Base64 string (provided by events)</li>
                             <li>Raw <code>AccessKey:SecretKey</code></li>
                             <li>Raw <code>AccessKey:SecretKey:SessionToken</code></li>
                          </ul>
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Key String</label>
                        <input 
                          type="text" 
                          value={awsConfig.apiKey}
                          onChange={e => setAwsConfig({...awsConfig, apiKey: e.target.value})}
                          className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none font-mono"
                          placeholder="Paste encoded string or key:secret..."
                          required={awsConfig.authType === 'apikey'}
                        />
                      </div>
                   </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 flex gap-2">
                       <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
                       <p>Use standard AWS Access Key ID and Secret Access Key from an IAM User with <strong>AmazonBedrockFullAccess</strong>.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Access Key ID</label>
                      <input 
                        type="text" 
                        value={awsConfig.accessKeyId}
                        onChange={e => setAwsConfig({...awsConfig, accessKeyId: e.target.value})}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none font-mono"
                        placeholder="AKIA... or ASIA..."
                        required={awsConfig.authType === 'standard'}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Secret Access Key</label>
                      <input 
                        type="password" 
                        value={awsConfig.secretAccessKey}
                        onChange={e => setAwsConfig({...awsConfig, secretAccessKey: e.target.value})}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none font-mono"
                        placeholder="Secret key..."
                        required={awsConfig.authType === 'standard'}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Session Token <span className="text-slate-400 font-normal lowercase">(optional, for temp keys)</span></label>
                      <input 
                        type="password" 
                        value={awsConfig.sessionToken || ''}
                        onChange={e => setAwsConfig({...awsConfig, sessionToken: e.target.value})}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none font-mono"
                        placeholder="Session token..."
                      />
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Region</label>
                      <select 
                        value={awsConfig.region}
                        onChange={e => setAwsConfig({...awsConfig, region: e.target.value})}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none bg-white"
                      >
                        <option value="us-east-1">US East (N. Virginia)</option>
                        <option value="us-west-2">US West (Oregon)</option>
                        <option value="eu-central-1">Europe (Frankfurt)</option>
                        <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Model (Inference Profile)</label>
                      <select 
                        value={isCustomModel ? 'custom' : awsConfig.modelId}
                        onChange={e => {
                          if(e.target.value === 'custom') {
                            setIsCustomModel(true);
                            setAwsConfig({...awsConfig, modelId: ''});
                          } else {
                            setIsCustomModel(false);
                            setAwsConfig({...awsConfig, modelId: e.target.value});
                          }
                        }}
                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none bg-white"
                      >
                         <optgroup label="Latest Global Models">
                          <option value="global.anthropic.claude-haiku-4-5-20251001-v1:0">Claude Haiku 4.5 (Global)</option>
                         </optgroup>
                        <optgroup label="Claude 3.5 (US Region)">
                          <option value="us.anthropic.claude-3-5-haiku-20241022-v1:0">Claude 3.5 Haiku v1</option>
                          <option value="us.anthropic.claude-3-5-sonnet-20241022-v2:0">Claude 3.5 Sonnet v2</option>
                          <option value="us.anthropic.claude-3-5-sonnet-20240620-v1:0">Claude 3.5 Sonnet v1</option>
                        </optgroup>
                        <optgroup label="Claude 3 (US Region)">
                           <option value="us.anthropic.claude-3-haiku-20240307-v1:0">Claude 3 Haiku</option>
                           <option value="us.anthropic.claude-3-sonnet-20240229-v1:0">Claude 3 Sonnet</option>
                           <option value="us.anthropic.claude-3-opus-20240229-v1:0">Claude 3 Opus</option>
                        </optgroup>
                        <option value="custom" className="text-orange-600 font-semibold">+ Custom Model ID</option>
                      </select>
                    </div>
                  </div>
                  
                  {isCustomModel && (
                    <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                      <label className="block text-xs font-bold text-orange-700 uppercase mb-1 flex items-center gap-1">
                        <Edit3 size={12} /> Custom Model ID
                      </label>
                      <input 
                        type="text"
                        value={awsConfig.modelId}
                        onChange={e => setAwsConfig({...awsConfig, modelId: e.target.value})}
                        className="w-full border border-orange-200 bg-orange-50 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none placeholder-orange-300 text-orange-900"
                        placeholder="e.g. us.anthropic.claude-3-5-haiku..."
                      />
                      <p className="text-[10px] text-orange-600 mt-1">
                        Use the <strong>Inference Profile ID</strong> (starts with <code>us.</code> or <code>global.</code>).
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 flex justify-end gap-3 border-t border-slate-100 mt-6">
                <button 
                  type="button" 
                  onClick={() => setShowAwsModal(false)}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-6 py-2 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 transition-colors text-sm shadow-sm flex items-center gap-2"
                >
                  <CheckCircle2 size={16} />
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Input & Controls */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Input Card */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col h-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                <FileCode size={18} /> Sitemap XML
              </h2>
              <div className="flex gap-2">
                 <button 
                  onClick={triggerFileUpload}
                  className="text-xs text-slate-500 hover:text-blue-600 font-medium flex items-center gap-1 px-2 py-1 hover:bg-slate-50 rounded transition-colors"
                  disabled={appState === AppState.PROCESSING}
                  title="Upload partial JSON results to resume"
                >
                  <Upload size={12} /> Upload JSON
                </button>
                <button 
                  onClick={loadExample}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline px-2 py-1"
                  disabled={appState === AppState.PROCESSING}
                >
                  Example
                </button>
              </div>
            </div>
            
            <textarea
              value={sitemapInput}
              onChange={(e) => setSitemapInput(e.target.value)}
              className="w-full flex-1 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[300px]"
              placeholder="Paste your sitemap XML here..."
              disabled={appState === AppState.PROCESSING}
            />

            {results.length > 0 && appState !== AppState.PROCESSING && (
               <div className="mt-3 bg-blue-50 border border-blue-100 rounded-md p-3 flex justify-between items-center">
                 <div className="text-xs text-blue-700">
                   <span className="font-semibold">{results.length} records</span> loaded and ready to merge.
                 </div>
                 <button 
                    onClick={clearSession}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                    title="Clear session"
                 >
                   <Trash2 size={14} />
                 </button>
               </div>
            )}

            <div className="mt-4 pt-4 border-t border-slate-100">
              {appState === AppState.PROCESSING ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-end text-xs text-slate-500 mb-1">
                    <span className="flex items-center gap-1.5 font-medium text-slate-600">
                      Processing...
                      {eta && (
                        <span className="flex items-center gap-1 text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded ml-2">
                          <Timer size={10} />
                          {eta} left
                        </span>
                      )}
                    </span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ease-out ${provider === 'bedrock' ? 'bg-orange-500' : 'bg-blue-600'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-center text-slate-400 animate-pulse">
                    Scraping & Classifying content with {provider === 'gemini' ? 'Gemini' : 'Bedrock'}...
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleStart}
                  className={`w-full py-3 text-white rounded-lg font-medium shadow-sm transition-colors flex items-center justify-center gap-2
                    ${provider === 'bedrock' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {results.length > 0 ? (
                     <>
                      <RefreshCw size={18} />
                      Resume Process
                     </>
                  ) : (
                    <>
                      <Play size={18} fill="currentColor" />
                      Run Process
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Download Card */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 mb-3">
              <Database className="text-slate-400" size={20} />
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Export Data</h3>
                <p className="text-xs text-slate-500">{results.length} records ready</p>
              </div>
            </div>
            <button
              onClick={downloadJson}
              disabled={results.length === 0}
              className={`w-full py-2 border rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors
                ${results.length > 0 
                  ? 'border-slate-300 text-slate-700 hover:bg-slate-50' 
                  : 'border-slate-100 text-slate-300 cursor-not-allowed'
                }`}
            >
              <Download size={16} />
              Download JSON
            </button>
          </div>

        </div>

        {/* Right Column: Visualization & List */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Dashboard Area */}
          <div className="min-h-[300px]">
             <Dashboard results={results} />
          </div>

          {/* Process List */}
          <ProcessList items={queue} />

        </div>
      </main>
    </div>
  );
}