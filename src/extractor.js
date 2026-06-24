import axios from 'axios';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { sources, getSourceById } from './sources.js';

export class AdvancedExtractor {
  constructor() {
    this.browser = null;
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true' || true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });
    }
    return this.browser;
  }

  async extract({ source, movieId, season, episode, options = {} }) {
    const sourceData = getSourceById(source);
    
    if (!sourceData) {
      throw new Error(`Source "${source}" not found`);
    }

    const baseUrl = sourceData.baseUrl;
    let embedUrl;

    if (season && episode) {
      embedUrl = `${baseUrl}${movieId}/${season}/${episode}`;
    } else {
      embedUrl = `${baseUrl}${movieId}`;
    }

    console.log(`🎬 Extracting from ${sourceData.name}: ${embedUrl}`);

    try {
      const browser = await this.initBrowser();
      const page = await browser.newPage();
      
      await page.goto(embedUrl, { 
        waitUntil: 'networkidle',
        timeout: parseInt(process.env.BROWSER_TIMEOUT) || 30000
      });

      const m3u8Urls = await this.extractM3U8FromPage(page);
      
      let subtitles = [];
      if (options.fetchSubtitles !== false) {
        subtitles = await this.extractSubtitles(page);
      }

      await page.close();

      return {
        source: sourceData.name,
        sourceId: source,
        movieId,
        season,
        episode,
        embedUrl,
        m3u8Urls,
        subtitles,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Error from ${sourceData.name}:`, error.message);
      return await this.fallbackExtract(embedUrl, sourceData, movieId);
    }
  }

  async extractM3U8FromPage(page) {
    const m3u8Urls = [];
    const foundUrls = new Set();

    page.on('response', async (response) => {
      const url = response.url();
      if ((url.includes('.m3u8') || url.includes('m3u8')) && !foundUrls.has(url)) {
        foundUrls.add(url);
        m3u8Urls.push({
          url,
          quality: await this.detectQualityFromUrl(url),
          type: 'hls'
        });
      }
    });

    const jsUrls = await page.evaluate(() => {
      const urls = new Set();
      const patterns = [
        /["'](https?://[^"']*.m3u8[^"']*)["']/gi,
        /source:s*["'](https?://[^"']*.m3u8[^"']*)["']/gi,
        /file:s*["'](https?://[^"']*.m3u8[^"']*)["']/gi
      ];

      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
        const content = script.textContent || script.innerHTML;
        patterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            urls.add(match[1]);
          }
        });
      });

      return Array.from(urls);
    });

    jsUrls.forEach(url => {
      if (!foundUrls.has(url)) {
        m3u8Urls.push({
          url,
          quality: this.detectQualityFromUrl(url),
          type: 'hls'
        });
      }
    });

    return [...new Map(m3u8Urls.map(item => [item.url, item])).values()];
  }

  async extractSubtitles(page) {
    const subtitles = [];

    const subData = await page.evaluate(() => {
      const subs = [];
      const seenUrls = new Set();

      const tracks = document.querySelectorAll('track');
      tracks.forEach(track => {
        if ((track.kind === 'subtitles' || track.kind === 'captions') && !seenUrls.has(track.src)) {
          seenUrls.add(track.src);
          subs.push({
            url: track.src,
            language: track.label || track.srclang || 'en',
            type: track.src.includes('.vtt') ? 'vtt' : 'srt'
          });
        }
      });

      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
        const content = script.textContent || script.innerHTML;
        const patterns = [
          /subtitles?:s*["'](https?://[^"']*.(vtt|srt)[^"']*)["']/gi,
          /tracks?:s*["'](https?://[^"']*.(vtt|srt)[^"']*)["']/gi
        ];

        patterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const url = match[1];
            if (url && !seenUrls.has(url)) {
              seenUrls.add(url);
              subs.push({
                url: url.replace(/["']/g, ''),
                language: 'auto',
                type: url.includes('vtt') ? 'vtt' : 'srt'
              });
            }
          }
        });
      });

      return subs;
    });

    return [...new Map(subData.map(item => [item.url, item])).values()];
  }

  async detectQualityFromUrl(url) {
    if (/4k|2160p|uhd/i.test(url)) return '4k';
    if (/1080p|fhd/i.test(url)) return '1080p';
    if (/720p|hd/i.test(url)) return '720p';
    if (/480p|sd/i.test(url)) return '480p';
    return 'auto';
  }

  async fallbackExtract(embedUrl, sourceData, movieId) {
    try {
      const response = await axios.get(embedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: parseInt(process.env.API_TIMEOUT) || 10000
      });

      const $ = cheerio.load(response.data);
      const m3u8Urls = [];

      $('script').each((_, element) => {
        const content = $(element).html() || '';
        const m3u8Pattern = /(https?://[^"'s]*.m3u8[^"'s]*)/gi;
        let match;
        
        while ((match = m3u8Pattern.exec(content)) !== null) {
          m3u8Urls.push({
            url: match[1],
            quality: this.detectQualityFromUrl(match[1]),
            type: 'hls'
          });
        }
      });

      return {
        source: sourceData.name,
        sourceId: sourceData.id,
        movieId,
        embedUrl,
        m3u8Urls,
        subtitles: [],
        timestamp: new Date().toISOString(),
        method: 'fallback'
      };

    } catch (error) {
      throw new Error(`Failed to extract from ${sourceData.name}: ${error.message}`);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
