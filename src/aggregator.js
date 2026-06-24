import async from 'async';
import { sources, getTier1Sources, getTier2Sources } from './sources.js';

export class MultiSourceAggregator {
  constructor(extractor) {
    this.extractor = extractor;
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT) || 5;
  }

  async aggregateAllSources({ movieId, season, episode, options = {} }) {
    const {
      limit = 10,
      quality = '4k',
      fastMode = true,
      parallel = true
    } = options;

    const startTime = Date.now();
    const results = {
      movieId,
      season,
      episode,
      sources: [],
      bestQuality: null,
      subtitles: [],
      timestamp: new Date().toISOString()
    };

    console.log(`🌟 Aggregating from ${sources.length} sources for: ${movieId}`);

    let sourcesToUse = fastMode ? [...getTier1Sources(), ...getTier2Sources()] : sources;
    sourcesToUse.sort((a, b) => a.priority - b.priority);

    if (limit && sourcesToUse.length > limit) {
      sourcesToUse = sourcesToUse.slice(0, limit);
    }

    if (parallel) {
      const queue = async.queue(async (sourceData) => {
        try {
          const result = await this.extractor.extract({
            source: sourceData.id,
            movieId,
            season,
            episode,
            options: { fetchSubtitles: true, targetQuality: quality }
          });

          if (result.m3u8Urls && result.m3u8Urls.length > 0) {
            results.sources.push({
              source: sourceData.name,
              sourceId: sourceData.id,
              tier: sourceData.tier,
              m3u8Urls: result.m3u8Urls,
              subtitles: result.subtitles,
              embedUrl: result.embedUrl
            });

            result.subtitles.forEach(sub => {
              if (!results.subtitles.find(s => s.url === sub.url)) {
                results.subtitles.push(sub);
              }
            });
          }
        } catch (error) {
          console.warn(`Failed ${sourceData.name}:`, error.message);
        }
      }, this.maxConcurrent);

      sourcesToUse.forEach(source => queue.push(source));
      await queue.drain();

    } else {
      for (const sourceData of sourcesToUse) {
        try {
          const result = await this.extractor.extract({
            source: sourceData.id,
            movieId,
            season,
            episode,
            options: { fetchSubtitles: true, targetQuality: quality }
          });

          if (result.m3u8Urls && result.m3u8Urls.length > 0) {
            results.sources.push({
              source: sourceData.name,
              sourceId: sourceData.id,
              tier: sourceData.tier,
              m3u8Urls: result.m3u8Urls,
              subtitles: result.subtitles,
              embedUrl: result.embedUrl
            });
          }
        } catch (error) {
          console.warn(`Failed ${sourceData.name}:`, error.message);
        }
      }
    }

    const processingTime = Date.now() - startTime;

    results.summary = {
      totalSources: sourcesToUse.length,
      successfulSources: results.sources.length,
      failedSources: sourcesToUse.length - results.sources.length,
      totalM3U8Links: results.sources.reduce((sum, s) => sum + s.m3u8Urls.length, 0),
      totalSubtitles: results.subtitles.length,
      processingTimeMs: processingTime
    };

    return results;
  }
}
