import React, { useState, useCallback, useRef } from 'react';
import { 
  Play, 
  Download, 
  Database, 
  BrainCircuit, 
  FileCode,
  AlertCircle,
  Timer
} from 'lucide-react';
import { parseSitemap, scrapeContent } from './services/crawler';
import { classifyPageContent } from './services/gemini';
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

export default function App() {
  const [sitemapInput, setSitemapInput] = useState<string>('');
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [queue, setQueue] = useState<ProcessingStatus[]>([]);
  const [results, setResults] = useState<ClassifiedPage[]>([]);
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState<string>('');
  
  // Ref to handle cancellation/stopping if needed
  const isRunning = useRef(false);

  const handleStart = async () => {
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

      // Initialize Queue
      const initialQueue: ProcessingStatus[] = urls.map(url => ({
        url,
        status: 'pending'
      }));

      setQueue(initialQueue);
      setResults([]);
      setAppState(AppState.PROCESSING);
      setProgress(0);
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
    // Process strictly sequentially to avoid rate limits on generic proxy & Gemini
    const currentItems = [...items];
    const startTime = Date.now();

    for (let i = 0; i < currentItems.length; i++) {
      if (!isRunning.current) break;

      // Update Status: Scraping
      setQueue(prev => {
        const newQ = [...prev];
        newQ[i] = { ...newQ[i], status: 'scraping' };
        return newQ;
      });

      try {
        const text = await scrapeContent(currentItems[i].url);
        
        // Update Status: Classifying
        setQueue(prev => {
          const newQ = [...prev];
          newQ[i] = { ...newQ[i], status: 'classifying' };
          return newQ;
        });

        const classifiedData = await classifyPageContent(currentItems[i].url, text);
        
        // Update Status: Completed
        setResults(prev => [...prev, classifiedData]);
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

      // Calculate ETA
      const now = Date.now();
      const elapsed = now - startTime;
      const completedCount = i + 1;
      const averageTimePerItem = elapsed / completedCount;
      const remainingItems = currentItems.length - completedCount;
      const estimatedRemainingMs = averageTimePerItem * remainingItems;
      
      setEta(formatTime(estimatedRemainingMs));
      setProgress((completedCount / currentItems.length) * 100);
      
      // Artificial delay to be gentle on the APIs
      await new Promise(resolve => setTimeout(resolve, 500));
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <BrainCircuit size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Encephalitis Content Classifier</h1>
              <p className="text-xs text-slate-500 font-medium">AI Data Engineer Agent</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-400">Powered by</p>
              <p className="text-sm font-semibold text-slate-700">Gemini 3 Flash</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Input & Controls */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Input Card */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col h-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                <FileCode size={18} /> Sitemap XML
              </h2>
              <button 
                onClick={loadExample}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline"
                disabled={appState === AppState.PROCESSING}
              >
                Load Example
              </button>
            </div>
            
            <textarea
              value={sitemapInput}
              onChange={(e) => setSitemapInput(e.target.value)}
              className="w-full flex-1 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[300px]"
              placeholder="Paste your sitemap XML here..."
              disabled={appState === AppState.PROCESSING}
            />

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
                      className="h-full bg-blue-500 transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-center text-slate-400 animate-pulse">
                    Scraping & Classifying content...
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleStart}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Play size={18} fill="currentColor" />
                  Run Process
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