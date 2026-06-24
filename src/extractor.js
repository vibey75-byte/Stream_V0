import axios from 'axios';
import { getSourceById } from './sources.js';

export class AdvancedExtractor {
  constructor() {
    this.reliabilityCache = new Map();
  }

  async extract({ source, movieId, season, episode, options = {} }) {
    const sourceData = getSourceById(source);
    if (!sourceData) throw new Error(`Source "${source}" not found`);

    let embedUrl;
    if (season && episode) {
      embedUrl = `${sourceData.baseUrl}${movieId}/${season}/${episode}`;
    } else {
      embedUrl = `${sourceData.baseUrl}${movieId}`;
    }

    try {
      const m3u8Urls = await this.fetchFromAPI(movieId, season, episode);
      await this.updateReliability(source, m3u8Urls.length > 0);
      return {
        source: sourceData.name,
        sourceId: source,
        movieId, season, episode, embedUrl,
        m3u8Urls,
        subtitles: [],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      await this.updateReliability(source, false);
      return {
        source: sourceData.name,
        sourceId: source,
        movieId, season, episode, embedUrl,
        m3u8Urls: [], subtitles: [],
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  async fetchFromAPI(movieId, season, episode) {
    const apis = [];

    // VidSrc.rip API
    if (season && episode) {
      apis.push(`https://vidsrc.rip/api/tv/${movieId}/${season}/${episode}`);
      apis.push(`https://vidsrc.icu/api/tv?imdb=${movieId}&season=${season}&episode=${episode}`);
      apis.push(`https://vidsrc.me/api/tv?imdb=${movieId}&season=${season}&episode=${episode}`);
    } else {
      apis.push(`https://vidsrc.rip/api/movie/${movieId}`);
      apis.push(`https://vidsrc.icu/api/movie?imdb=${movieId}`);
      apis.push(`https://vidsrc.me/api/movie?imdb=${movieId}`);
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://vidsrc.me/'
    };

    for (const url of apis) {
      try {
        const res = await axios.get(url, {
          headers,
          timeout: 10000,
          validateStatus: s => s < 500
        });

        if (res.data && res.status === 200) {
          const links = this.parseAPIResponse(res.data);
          if (links.length > 0) return links;
        }
      } catch (_) {}
    }

    return [];
  }

  parseAPIResponse(data) {
    const links = [];
    const foundUrls = new Set();

    const addUrl = (url) => {
      if (url && typeof url === 'string' && url.includes('.m3u8') && !foundUrls.has(url)) {
        foundUrls.add(url);
        links.push({ url, quality: this.detectQualityFromUrl(url), type: 'hls' });
      }
    };

    if (typeof data === 'string') {
      const matches = data.match(/https?:\/\/[^"'\s]*\.m3u8[^"'\s]*/gi) || [];
      matches.forEach(addUrl);
      return links;
    }

    if (Array.isArray(data)) {
      data.forEach(item => {
        addUrl(item?.url || item?.stream || item?.link || item?.src);
      });
      return links;
    }

    if (typeof data === 'object') {
      const checkObj = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        Object.values(obj).forEach(val => {
          if (typeof val === 'string') addUrl(val);
          else if (typeof val === 'object') checkObj(val);
        });
      };
      checkObj(data);
    }

    return links;
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
