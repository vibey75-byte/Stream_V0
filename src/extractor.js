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
          '--no-zygote',
          '--disable-web-security'
        ]
      });
    }
    return this.browser;
  }

  async extract({ source, movieId, season, episode, options = {} }) {
    const sourceData = getSourceById(source);
    if (!sourceData) throw new Error(`Source "${source}" not found`);

    let embedUrl = season && episode 
      ? `\( {sourceData.baseUrl} \){movieId}/\( {season}/ \){episode}`
      : `\( {sourceData.baseUrl} \){movieId}`;

    console.log(`Extracting from ${sourceData.name}: ${embedUrl}`);

    try {
      const browser = await this.initBrowser();
      const page = await browser.newPage();
      
      const m3u8Urls = [];
      const foundUrls = new Set();

      // مراقبة الاستجابات
      page.on('response', async (response) => {
        const url = response.url();
        if ((url.includes('.m3u8') || url.includes('master.m3u8')) && !foundUrls.has(url)) {
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
        timeout: parseInt(process.env.BROWSER_TIMEOUT) || 45000 
      });

      await page.waitForTimeout(8000); // زيادة وقت الانتظار

      // استخراج من JavaScript
      const jsUrls = await page.evaluate(() => {
        const urls = new Set();
        const regexes = [
          /["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi,
          /source:\s*["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi,
          /file:\s*["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi,
          /src:\s*["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi
        ];

        document.querySelectorAll('script').forEach(script => {
          const content = script.textContent || '';
          regexes.forEach(regex => {
            let match;
            while ((match = regex.exec(content)) !== null) {
              urls.add(match[1]);
            }
          });
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

      const subtitles = options.fetchSubtitles !== false 
        ? await this.extractSubtitles(page) 
        : [];

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
      console.error(`Error ${sourceData.name}:`, error.message);
      await this.updateReliability(source, false);
      return { ...this.emptyResult(sourceData, embedUrl, movieId, season, episode, error.message) };
    }
  }

  emptyResult(sourceData, embedUrl, movieId, season, episode, error) {
    return {
      source: sourceData.name,
      sourceId: sourceData.id,
      movieId,
      season,
      episode,
      embedUrl,
      m3u8Urls: [],
      subtitles: [],
      timestamp: new Date().toISOString(),
      error: error
    };
  }

  // باقي الدوال كما هي (extractSubtitles, detectQualityFromUrl, إلخ)
  async extractSubtitles(page) { /* ... نفس الكود السابق ... */ }
  detectQualityFromUrl(url) { /* ... نفس الكود ... */ }
  async updateReliability(sourceId, success) { /* ... */ }
  getReliabilityStats() { /* ... */ }
  async close() { /* ... */ }
}
