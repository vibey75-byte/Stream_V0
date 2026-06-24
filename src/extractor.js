import axios from 'axios';
import * as cheerio from 'cheerio';
import { getSourceById } from './sources.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

export class AdvancedExtractor {
  constructor() {
    this.reliabilityCache = new Map();
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

    console.log(`Extracting from ${sourceData.name}: ${embedUrl}`);

    try {
      const result = await this.fetchAndExtract(embedUrl, sourceData, movieId, season, episode);
      await this.updateReliability(source, result.m3u8Urls.length > 0);
      return result;
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

  async fetchAndExtract(embedUrl, sourceData, movieId, season, episode) {
    const headers = {
      'User-Agent': getRandomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.google.com/',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    };

    const response = await axios.get(embedUrl, {
      headers,
      timeout: parseInt(process.env.API_TIMEOUT) || 15000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    const html = response.data;
    const $ = cheerio.load(html);

    const m3u8Urls = [];
    const foundUrls = new Set();
    const subtitles = [];
    const seenSubs = new Set();

    $('script').each((_, el) => {
      const content = $(el).html() || '';

      const m3u8Patterns = [
        /["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi,
        /source:\s*["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi,
        /file:\s*["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi,
        /src:\s*["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`]/gi,
        /hls[Uu]rl["\s]*[:=]["\s]*["'`]?(https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`\s,;]/gi,
        /manifest["\s]*[:=]["\s]*["'`]?(https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*?)["'`\s,;]/gi,
        /"url"\s*:\s*"(https?:\/\/[^"]*\.m3u8[^"]*)"/gi,
        /\burl\s*=\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)/gi
      ];

      m3u8Patterns.forEach(pattern => {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          const url = match[1];
          if (url && !foundUrls.has(url)) {
            foundUrls.add(url);
            m3u8Urls.push({
              url,
              quality: this.detectQualityFromUrl(url),
              type: 'hls'
            });
          }
        }
      });

      const subPatterns = [
        /["'`](https?:\/\/[^"'`\s]*\.(vtt|srt)[^"'`\s]*?)["'`]/gi,
        /subtitle[s]?\s*:\s*["'`](https?:\/\/[^"'`\s]*\.(vtt|srt)[^"'`\s]*?)["'`]/gi
      ];

      subPatterns.forEach(pattern => {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          const url = match[1];
          if (url && !seenSubs.has(url)) {
            seenSubs.add(url);
            subtitles.push({
              url,
              language: 'auto',
              type: url.includes('.vtt') ? 'vtt' : 'srt'
            });
          }
        }
      });
    });

    $('source').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (src.includes('.m3u8') && !foundUrls.has(src)) {
        foundUrls.add(src);
        m3u8Urls.push({ url: src, quality: this.detectQualityFromUrl(src), type: 'hls' });
      }
    });

    $('track').each((_, el) => {
      const src = $(el).attr('src') || '';
      const kind = $(el).attr('kind') || '';
      if ((kind === 'subtitles' || kind === 'captions') && src && !seenSubs.has(src)) {
        seenSubs.add(src);
        subtitles.push({
          url: src,
          language: $(el).attr('label') || $(el).attr('srclang') || 'en',
          type: src.includes('.vtt') ? 'vtt' : 'srt'
        });
      }
    });

    if (m3u8Urls.length === 0) {
      const iframeSrc = $('iframe').first().attr('src');
      if (iframeSrc && iframeSrc.startsWith('http') && iframeSrc !== embedUrl) {
        try {
          const nested = await this.fetchAndExtract(iframeSrc, sourceData, movieId, season, episode);
          return nested;
        } catch (_) {}
      }
    }

    return {
      source: sourceData.name,
      sourceId: sourceData.id,
      movieId,
      season,
      episode,
      embedUrl,
      m3u8Urls: [...new Map(m3u8Urls.map(item => [item.url, item])).values()],
      subtitles: [...new Map(subtitles.map(item => [item.url, item])).values()],
      timestamp: new Date().toISOString()
    };
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

  async close() {}
}
