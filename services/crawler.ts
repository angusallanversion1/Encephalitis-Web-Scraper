/**
 * Parses an XML Sitemap string and returns a list of URLs.
 * Includes fallback logic for malformed XML or inputs with browser headers.
 */
export const parseSitemap = (xmlContent: string): string[] => {
  const parser = new DOMParser();
  
  // Try to find the start of the XML content to handle copy-pastes that include headers
  const startIndex = xmlContent.indexOf("<?xml");
  const cleanContent = startIndex >= 0 ? xmlContent.substring(startIndex) : xmlContent;

  const xmlDoc = parser.parseFromString(cleanContent, "text/xml");
  const urls: string[] = [];
  
  // Method 1: Standard DOM Parsing
  const locs = xmlDoc.getElementsByTagName("loc");
  if (locs.length > 0) {
    for (let i = 0; i < locs.length; i++) {
      const loc = locs[i].textContent;
      if (loc) {
        urls.push(loc.trim());
      }
    }
    return urls;
  }

  // Method 2: Fallback Regex Extraction
  // Use this if DOM parsing fails (e.g. parsererror, namespace issues, or extremely malformed input)
  console.warn("DOM extraction yielded 0 URLs. Attempting Regex fallback.");
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(xmlContent)) !== null) {
    if (match[1]) {
      urls.push(match[1].trim());
    }
  }

  return urls;
};

/**
 * Fetches URL content using multiple CORS proxy strategies.
 * Tries strategies sequentially until one succeeds.
 */
export const scrapeContent = async (url: string): Promise<string> => {
  
  // Define scraping strategies
  const strategies = [
    {
      name: 'AllOrigins',
      getUrl: (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
      handler: async (res: Response) => {
        const data = await res.json();
        return data.contents;
      }
    },
    {
      name: 'CodeTabs',
      getUrl: (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
      handler: async (res: Response) => await res.text()
    },
    {
      name: 'ThingProxy',
      getUrl: (u: string) => `https://thingproxy.freeboard.io/fetch/${u}`,
      handler: async (res: Response) => await res.text()
    },
    {
      name: 'CorsProxy',
      getUrl: (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      handler: async (res: Response) => await res.text()
    }
  ];

  let htmlContent: string | null = null;
  const errorDetails: string[] = [];

  for (const strategy of strategies) {
    if (htmlContent) break; // Stop if we have content

    try {
      // Create a timeout for each request to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(strategy.getUrl(url), { 
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const content = await strategy.handler(response);
        if (content && content.length > 50) { // Basic validation that we got something substantial
          htmlContent = content;
        } else {
          errorDetails.push(`${strategy.name}: Returned empty or too short content`);
        }
      } else {
        errorDetails.push(`${strategy.name}: HTTP ${response.status}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Clean up abort error messages
      const cleanMsg = msg.includes('aborted') ? 'Timeout' : msg;
      errorDetails.push(`${strategy.name}: ${cleanMsg}`);
    }
  }

  // If all strategies fail
  if (!htmlContent) {
    console.error(`Scraping failed for ${url}. Details:`, errorDetails);
    throw new Error(`Failed to fetch content. Attempts: ${errorDetails.join(' | ')}`);
  }

  try {
    // Parse HTML to extract text
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");

    // Remove clutter elements
    const clutterSelectors = [
      'script', 'style', 'nav', 'footer', 'aside', 'header', 
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', 
      'iframe', 'noscript', 'svg', 'button', 'form'
    ];
    
    const elementsToRemove = doc.querySelectorAll(clutterSelectors.join(','));
    elementsToRemove.forEach(node => node.remove());

    // Get body text
    const bodyText = doc.body.textContent || "";
    
    // Clean up whitespace: replace multiple spaces/newlines with single space
    const cleanedText = bodyText.replace(/\s+/g, ' ').trim();
    
    // Limit length to ~30k chars to be safe for Gemini token limits while keeping enough context
    return cleanedText.substring(0, 30000); 
  } catch (error) {
    console.error(`Parsing failed for ${url}:`, error);
    throw new Error(`Parsing content failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};