import axios from 'axios';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { getSourceById } from './sources.js';

export class AdvancedExtractor {
  constructor() {
    this.browser = null;
    this.reliabilityCache = new Map();
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--single-process',
          '--no-zygote'
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

    let embedUrl;
    if (season && episode) {
      embedUrl = `${sourceData.baseUrl}${movieId}/${season}/${episode}`;
    } else {
      embedUrl = `${sourceData.baseUrl}${movieId}`;
    }

    console.log(`Extracting from ${sourceData.name}: ${embedUrl}`);

    try {
      const browser = await this.initBrowser();
      const page = await browser.newPage();

      const m3u8Urls = [];
      const foundUrls = new Set();

      page.on('response', async (response) => {
        const url = response.url();
        if ((url.includes('.m3u8') || url.includes('m3u8')) && !foundUrls.has(url)) {
          foundUrls.add(url);
          m3u8Urls.push({
            url,
            quality: this.detectQualityFromUrl(url),
            type: 'hls'
          });
        }
      });

      await page.goto(embedUrl, {
        waitUntil: 'networkidle',
        timeout: parseInt(process.env.BROWSER_TIMEOUT) || 30000
      });

      // انتظر 5 ثواني باش تحمل الـ M3U8
      await page.waitForTimeout(5000);

      const jsUrls = await page.evaluate(() => {
        const urls = new Set();
        document.querySelectorAll('script').forEach(script => {
          const content = script.textContent || '';
          const regex1 = /["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi;
          const regex2 = /source:\s*["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi;
          const regex3 = /file:\s*["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi;
          let match;
          while ((match = regex1.exec(content)) !== null) urls.add(match[1]);
          while ((match = regex2.exec(content)) !== null) urls.add(match[1]);
          while ((match = regex3.exec(content)) !== null) urls.add(match[1]);
        });
        return Array.from(urls);
      });

      jsUrls.forEach(url => {
        if (!foundUrls.has(url)) {
          foundUrls.add(url);
          m3u8Urls.push({
            url,
            quality: this.detectQualityFromUrl(url),
            type: 'hls'
          });
        }
      });

      let subtitles = [];
      if (options.fetchSubtitles !== false) {
        subtitles = await this.extractSubtitles(page);
      }

      await page.close();
      await this.updateReliability(source, true);

      return {
        source: sourceData.name,
        sourceId: source,
        movieId,
        season,
        episode,
        embedUrl,
        m3u8Urls: [...new Map(m3u8Urls.map(item => [item.url, item])).values()],
        subtitles,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Error from ${sourceData.name}:`, error.message);
      await this.updateReliability(source, false);
      return {
        source: sourceData.name,
        sourceId: source,
        movieId,
        season,
        episode,
        embedUrl,
        m3u8Urls: [],
        subtitles: [],
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  async extractSubtitles(page) {
    const subData = await page.evaluate(() => {
      const subs = [];
      const seenUrls = new Set();

      document.querySelectorAll('track').forEach(track => {
        if ((track.kind === 'subtitles' || track.kind === 'captions') && !seenUrls.has(track.src)) {
          seenUrls.add(track.src);
          subs.push({
            url: track.src,
            language: track.label || track.srclang || 'en',
            type: track.src.includes('.vtt') ? 'vtt' : 'srt'
          });
        }
      });

      document.querySelectorAll('script').forEach(script => {
        const content = script.textContent || '';
        const regex1 = /subtitles?:\s*["'`](https?:\/\/[^"'`\s]*\.(vtt|srt)[^"'`\s]*?)["'`]/gi;
        const regex2 = /tracks?:\s*["'`](https?:\/\/[^"'`\s]*\.(vtt|srt)[^"'`\s]*?)["'`]/gi;
        let match;
        while ((match = regex1.exec(content)) !== null) {
          if (!seenUrls.has(match[1])) {
            seenUrls.add(match[1]);
            subs.push({ url: match[1], language: 'auto', type: match[1].includes('vtt') ? 'vtt' : 'srt' });
          }
        }
        while ((match = regex2.exec(content)) !== null) {
          if (!seenUrls.has(match[1])) {
            seenUrls.add(match[1]);
            subs.push({ url: match[1], language: 'auto', type: match[1].includes('vtt') ? 'vtt' : 'srt' });
          }
        }
      });

      return subs;
    });

    return [...new Map(subData.map(item => [item.url, item])).values()];
  }

  detectQualityFromUrl(url) {
    if (/4k|2160p|uhd/i.test(url)) return '4k';
    if (/1080p|fhd/i.test(url)) return '1080p';
    if (/720p|hd/i.test(url)) return '720p';
    if (/480p|sd/i.test(url)) return '480p';
    return 'auto';
  }

  async updateReliability(sourceId, success) {
    const current = this.reliabilityCache.get(sourceId) || { tests: 0, successes: 0 };
    current.tests++;
    if (success) current.successes++;
    this.reliabilityCache.set(sourceId, current);
  }

  getReliabilityStats() {
    const stats = {};
    this.reliabilityCache.forEach((data, sourceId) => {
      stats[sourceId] = {
        reliability: (data.successes / data.tests) * 100,
        tests: data.tests,
        successes: data.successes
      };
    });
    return stats;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
