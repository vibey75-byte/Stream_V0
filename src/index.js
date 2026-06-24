import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AdvancedExtractor } from './extractor.js';
import { MultiSourceAggregator } from './aggregator.js';
import { sources, sourceStats } from './sources.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const extractor = new AdvancedExtractor();
const aggregator = new MultiSourceAggregator(extractor);

// Home
app.get('/', (req, res) => {
  res.json({
    name: 'Stream_V0',
    version: '1.0.0',
    author: 'Maaoui Adem',
    description: 'Professional Multi-Source M3U8 Extractor',
    features: [
      '✅ 50+ Sources Support',
      '✅ 4K Quality Extraction',
      '✅ Multi-Subtitle Support',
      '✅ Speed Optimization'
    ],
    stats: sourceStats,
    endpoints: {
      extract: '/api/extract',
      extractAll: '/api/extract-all',
      sources: '/api/sources',
      health: '/api/health'
    }
  });
});

// Sources List
app.get('/api/sources', (req, res) => {
  const { tier, quality, subtitle } = req.query;
  let filtered = sources;
  
  if (tier) filtered = filtered.filter(s => s.tier === parseInt(tier));
  if (quality === '4k') filtered = filtered.filter(s => s.supports4k);
  if (subtitle === 'true') filtered = filtered.filter(s => s.supportsSubtitles);
  
  res.json({ success: true, count: filtered.length, sources: filtered });
});

// Extract from Single Source
app.get('/api/extract', async (req, res) => {
  try {
    const { source, movieId, season, episode, subtitles = true, quality = '4k' } = req.query;
    
    if (!source || !movieId) {
      return res.status(400).json({ success: false, error: 'source and movieId required' });
    }

    const result = await extractor.extract({
      source,
      movieId,
      season: season ? parseInt(season) : null,
      episode: episode ? parseInt(episode) : null,
      options: {
        fetchSubtitles: subtitles === 'true',
        targetQuality: quality
      }
    });

    res.json({ success: true, data: result });

  } catch (error) {
    console.error('Extract error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Extract from All Sources
app.get('/api/extract-all', async (req, res) => {
  try {
    const { movieId, season, episode, limit = 10, quality = '4k', fast = true } = req.query;
    
    if (!movieId) {
      return res.status(400).json({ success: false, error: 'movieId required' });
    }

    const results = await aggregator.aggregateAllSources({
      movieId,
      season: season ? parseInt(season) : null,
      episode: episode ? parseInt(episode) : null,
      options: {
        limit: limit ? parseInt(limit) : 10,
        quality,
        fastMode: fast === 'true',
        parallel: true
      }
    });

    res.json({ success: true, data: results });

  } catch (error) {
    console.error('Aggregate error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sources: {
      total: sourceStats.total,
      with4k: sourceStats.with4k,
      withSubtitles: sourceStats.withSubtitles
    }
  });
});

// Start
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              🎬 Stream_V0 v1.0.0                          ║
║              👤 Author: Maaoui Adem                       ║
╠═══════════════════════════════════════════════════════════╣
║  ✅ ${sourceStats.total} Sources Loaded                    ║
║  ✅ ${sourceStats.with4k} Sources with 4K Support          ║
║  ✅ ${sourceStats.withSubtitles} Sources with Subtitles    ║
╠═══════════════════════════════════════════════════════════╣
║  📡 API: http://localhost:${PORT}                          ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('
🛑 Shutting down...');
  await extractor.close();
  process.exit(0);
});
