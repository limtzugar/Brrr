// ─── Deep Market Analysis Engine ──────────────────────────────────────────
// Themes, companies, Monte Carlo simulation, What-If scenarios

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Theme {
  id: string
  name: string
  color: string
  pixelIcon: string[] // 8x8 pixel art grid
  companies: Company[]
  subThemes: SubTheme[]
}

export interface SubTheme {
  id: string
  name: string
  weight: number // 0-1, how much this sub-theme contributes
}

export interface Company {
  symbol: string
  name: string
  marketCap: number // billions
  sector: string
  relevance: number // 0-1
  price?: number
  change24h?: number
}

export interface ThemeConnection {
  from: string
  to: string
  type: 'supply_chain' | 'dependency' | 'competitor' | 'complement'
  strength: number // 0-1
}

export interface MonteCarloResult {
  paths: number[][]
  median: number[]
  p5: number[]
  p25: number[]
  p75: number[]
  p95: number[]
  currentPrice: number
  chanceUp: number
  finalMedian: number
  horizon: number
}

export interface WhatIfScenario {
  id: string
  name: string
  emoji: string
  description: string
  impacts: Record<string, number> // theme id -> impact % (-50 to +50)
}

// ─── 8-bit Pixel Icons (8x8 grids) ──────────────────────────────────────────

const PIXEL_ICONS: Record<string, string[]> = {
  ai: [
    '00000000',
    '00111100',
    '01111110',
    '01011010',
    '01111110',
    '00111100',
    '00011000',
    '00011000',
  ],
  health: [
    '00011000',
    '00011000',
    '01111110',
    '01111110',
    '01111110',
    '01111110',
    '00011000',
    '00011000',
  ],
  energy: [
    '00011000',
    '00111100',
    '01111110',
    '11111111',
    '00011000',
    '00011000',
    '00011000',
    '00011000',
  ],
  military: [
    '01111110',
    '11111111',
    '11111111',
    '11111111',
    '01111110',
    '00111100',
    '00011000',
    '00000000',
  ],
  finance: [
    '00111100',
    '01111110',
    '01100110',
    '01111110',
    '01111110',
    '01100110',
    '01111110',
    '00111100',
  ],
  infra: [
    '11111111',
    '10000001',
    '10000001',
    '10000001',
    '11111111',
    '10000001',
    '10000001',
    '11111111',
  ],
  esg: [
    '00011000',
    '00111100',
    '01111110',
    '11111111',
    '11111111',
    '00111100',
    '00111100',
    '00111100',
  ],
  biotech: [
    '00011000',
    '00111100',
    '01111110',
    '11111111',
    '11111111',
    '01111110',
    '00111100',
    '00011000',
  ],
  semi: [
    '11111111',
    '10011001',
    '10011001',
    '10011001',
    '10011001',
    '10011001',
    '10011001',
    '11111111',
  ],
}

// ─── Themes Data ────────────────────────────────────────────────────────────

export const THEMES: Theme[] = [
  {
    id: 'ai',
    name: 'AI / Sztuczna Inteligencja',
    color: '#8B5CF6',
    pixelIcon: PIXEL_ICONS.ai,
    subThemes: [
      { id: 'ai_chips', name: 'Chipy AI', weight: 0.3 },
      { id: 'ai_cloud', name: 'Cloud Computing', weight: 0.25 },
      { id: 'ai_data', name: 'Bazy Danych', weight: 0.2 },
      { id: 'ai_software', name: 'Oprogramowanie AI', weight: 0.15 },
      { id: 'ai_robotics', name: 'Robotyka', weight: 0.1 },
    ],
    companies: [
      { symbol: 'NVDA', name: 'NVIDIA', marketCap: 2200, sector: 'Semiconductors', relevance: 0.95 },
      { symbol: 'MSFT', name: 'Microsoft', marketCap: 2800, sector: 'Software', relevance: 0.9 },
      { symbol: 'GOOGL', name: 'Alphabet', marketCap: 1900, sector: 'Internet', relevance: 0.85 },
      { symbol: 'META', name: 'Meta', marketCap: 1200, sector: 'Social Media', relevance: 0.8 },
      { symbol: 'AMD', name: 'AMD', marketCap: 250, sector: 'Semiconductors', relevance: 0.8 },
      { symbol: 'PLTR', name: 'Palantir', marketCap: 50, sector: 'Data Analytics', relevance: 0.75 },
      { symbol: 'SNOW', name: 'Snowflake', marketCap: 60, sector: 'Cloud Data', relevance: 0.7 },
      { symbol: 'MDB', name: 'MongoDB', marketCap: 20, sector: 'Databases', relevance: 0.65 },
    ],
  },
  {
    id: 'health',
    name: 'Zdrowie / Healthcare',
    color: '#EF4444',
    pixelIcon: PIXEL_ICONS.health,
    subThemes: [
      { id: 'health_pharma', name: 'Pharma', weight: 0.35 },
      { id: 'health_devices', name: 'Medical devices', weight: 0.25 },
      { id: 'health_biotech', name: 'Biotech', weight: 0.2 },
      { id: 'health_insurance', name: 'Ubezpieczenia zdrowotne', weight: 0.2 },
    ],
    companies: [
      { symbol: 'JNJ', name: 'Johnson & Johnson', marketCap: 400, sector: 'Pharma', relevance: 0.9 },
      { symbol: 'UNH', name: 'UnitedHealth', marketCap: 500, sector: 'Insurance', relevance: 0.85 },
      { symbol: 'PFE', name: 'Pfizer', marketCap: 160, sector: 'Pharma', relevance: 0.8 },
      { symbol: 'ABBV', name: 'AbbVie', marketCap: 280, sector: 'Pharma', relevance: 0.8 },
      { symbol: 'MRK', name: 'Merck', marketCap: 300, sector: 'Pharma', relevance: 0.75 },
      { symbol: 'TMO', name: 'Thermo Fisher', marketCap: 200, sector: 'Devices', relevance: 0.7 },
    ],
  },
  {
    id: 'energy',
    name: 'Energia / Energy',
    color: '#F59E0B',
    pixelIcon: PIXEL_ICONS.energy,
    subThemes: [
      { id: 'energy_oil', name: 'Ropa naftowa', weight: 0.3 },
      { id: 'energy_renewable', name: 'OZE', weight: 0.3 },
      { id: 'energy_nuclear', name: 'Nuklearna', weight: 0.2 },
      { id: 'energy_grid', name: 'Sieci energetyczne', weight: 0.2 },
    ],
    companies: [
      { symbol: 'XOM', name: 'ExxonMobil', marketCap: 450, sector: 'Oil & Gas', relevance: 0.9 },
      { symbol: 'CVX', name: 'Chevron', marketCap: 300, sector: 'Oil & Gas', relevance: 0.85 },
      { symbol: 'NEE', name: 'NextEra Energy', marketCap: 150, sector: 'Renewable', relevance: 0.8 },
      { symbol: 'ENPH', name: 'Enphase Energy', marketCap: 15, sector: 'Solar', relevance: 0.75 },
      { symbol: 'BE', name: 'Bloom Energy', marketCap: 5, sector: 'Fuel Cells', relevance: 0.7 },
      { symbol: 'CCJ', name: 'Cameco', marketCap: 15, sector: 'Uranium', relevance: 0.7 },
    ],
  },
  {
    id: 'military',
    name: 'Militaria / Defense',
    color: '#6B7280',
    pixelIcon: PIXEL_ICONS.military,
    subThemes: [
      { id: 'mil_aero', name: 'Lotnictwo wojskowe', weight: 0.35 },
      { id: 'mil_cyber', name: 'Cybersecurity', weight: 0.25 },
      { id: 'mil_weapons', name: 'Uzbrojenie', weight: 0.25 },
      { id: 'mil_space', name: 'Space / Kosmos', weight: 0.15 },
    ],
    companies: [
      { symbol: 'LMT', name: 'Lockheed Martin', marketCap: 110, sector: 'Aerospace', relevance: 0.95 },
      { symbol: 'RTX', name: 'RTX Corp', marketCap: 130, sector: 'Aerospace', relevance: 0.9 },
      { symbol: 'NOC', name: 'Northrop Grumman', marketCap: 70, sector: 'Aerospace', relevance: 0.85 },
      { symbol: 'GD', name: 'General Dynamics', marketCap: 80, sector: 'Defense', relevance: 0.8 },
      { symbol: 'CRWD', name: 'CrowdStrike', marketCap: 70, sector: 'Cybersecurity', relevance: 0.7 },
      { symbol: 'PANW', name: 'Palo Alto Networks', marketCap: 120, sector: 'Cybersecurity', relevance: 0.7 },
    ],
  },
  {
    id: 'finance',
    name: 'Finanse / Finance',
    color: '#10B981',
    pixelIcon: PIXEL_ICONS.finance,
    subThemes: [
      { id: 'fin_banking', name: 'Banking', weight: 0.35 },
      { id: 'fin_payments', name: 'Payments', weight: 0.25 },
      { id: 'fin_insurance', name: 'Ubezpieczenia', weight: 0.2 },
      { id: 'fin_fintech', name: 'FinTech', weight: 0.2 },
    ],
    companies: [
      { symbol: 'JPM', name: 'JPMorgan Chase', marketCap: 500, sector: 'Banking', relevance: 0.9 },
      { symbol: 'BAC', name: 'Bank of America', marketCap: 300, sector: 'Banking', relevance: 0.85 },
      { symbol: 'V', name: 'Visa', marketCap: 500, sector: 'Payments', relevance: 0.85 },
      { symbol: 'MA', name: 'Mastercard', marketCap: 400, sector: 'Payments', relevance: 0.8 },
      { symbol: 'SQ', name: 'Block Inc', marketCap: 40, sector: 'FinTech', relevance: 0.7 },
      { symbol: 'PYPL', name: 'PayPal', marketCap: 70, sector: 'FinTech', relevance: 0.7 },
    ],
  },
  {
    id: 'infra',
    name: 'Infrastruktura / Infrastructure',
    color: '#F97316',
    pixelIcon: PIXEL_ICONS.infra,
    subThemes: [
      { id: 'infra_construction', name: 'Budownictwo', weight: 0.3 },
      { id: 'infra_materials', name: 'Materials', weight: 0.25 },
      { id: 'infra_transport', name: 'Transport', weight: 0.25 },
      { id: 'infra_telecom', name: 'Telekomunikacja', weight: 0.2 },
    ],
    companies: [
      { symbol: 'CAT', name: 'Caterpillar', marketCap: 170, sector: 'Construction', relevance: 0.9 },
      { symbol: 'DE', name: 'John Deere', marketCap: 120, sector: 'Machinery', relevance: 0.85 },
      { symbol: 'UNP', name: 'Union Pacific', marketCap: 150, sector: 'Rail', relevance: 0.8 },
      { symbol: 'FCX', name: 'Freeport-McMoRan', marketCap: 60, sector: 'Mining', relevance: 0.75 },
      { symbol: 'NEM', name: 'Newmont', marketCap: 50, sector: 'Mining', relevance: 0.7 },
      { symbol: 'T', name: 'AT&T', marketCap: 130, sector: 'Telecom', relevance: 0.65 },
    ],
  },
  {
    id: 'esg',
    name: 'ESG / Sustainable Development',
    color: '#22C55E',
    pixelIcon: PIXEL_ICONS.esg,
    subThemes: [
      { id: 'esg_carbon', name: 'Redukcja CO2', weight: 0.3 },
      { id: 'esg_water', name: 'Gospodarka wodna', weight: 0.2 },
      { id: 'esg_waste', name: 'Recykling', weight: 0.25 },
      { id: 'esg_social', name: 'Social responsibility', weight: 0.25 },
    ],
    companies: [
      { symbol: 'TSLA', name: 'Tesla', marketCap: 800, sector: 'EV', relevance: 0.9 },
      { symbol: 'ICLN', name: 'iShares Clean Energy', marketCap: 5, sector: 'ETF', relevance: 0.8 },
      { symbol: 'ENPH', name: 'Enphase', marketCap: 15, sector: 'Solar', relevance: 0.75 },
      { symbol: 'SEDG', name: 'SolarEdge', marketCap: 8, sector: 'Solar', relevance: 0.7 },
      { symbol: 'XYL', name: 'Xylem', marketCap: 30, sector: 'Water', relevance: 0.7 },
      { symbol: 'WM', name: 'Waste Management', marketCap: 80, sector: 'Waste', relevance: 0.65 },
    ],
  },
  {
    id: 'biotech',
    name: 'Biotechnologia',
    color: '#EC4899',
    pixelIcon: PIXEL_ICONS.biotech,
    subThemes: [
      { id: 'bio_genomics', name: 'Genomika', weight: 0.3 },
      { id: 'bio_gene_therapy', name: 'Terapia genowa', weight: 0.25 },
      { id: 'bio_diagnostics', name: 'Diagnostyka', weight: 0.25 },
      { id: 'bio_agri', name: 'Agri-biotech', weight: 0.2 },
    ],
    companies: [
      { symbol: 'AMGN', name: 'Amgen', marketCap: 150, sector: 'Biotech', relevance: 0.9 },
      { symbol: 'GILD', name: 'Gilead', marketCap: 100, sector: 'Biotech', relevance: 0.85 },
      { symbol: 'REGN', name: 'Regeneron', marketCap: 80, sector: 'Biotech', relevance: 0.8 },
      { symbol: 'VRTX', name: 'Vertex Pharma', marketCap: 100, sector: 'Biotech', relevance: 0.8 },
      { symbol: 'MRNA', name: 'Moderna', marketCap: 40, sector: 'mRNA', relevance: 0.75 },
      { symbol: 'ILMN', name: 'Illumina', marketCap: 30, sector: 'Genomics', relevance: 0.7 },
    ],
  },
  {
    id: 'semi',
    name: 'Semiconductors / Semiconductors',
    color: '#3B82F6',
    pixelIcon: PIXEL_ICONS.semi,
    subThemes: [
      { id: 'semi_design', name: 'Chip Design', weight: 0.3 },
      { id: 'semi_fab', name: 'Fabrication', weight: 0.3 },
      { id: 'semi_equipment', name: 'Equipment', weight: 0.2 },
      { id: 'semi_materials', name: 'Materials', weight: 0.2 },
    ],
    companies: [
      { symbol: 'NVDA', name: 'NVIDIA', marketCap: 2200, sector: 'GPU', relevance: 0.95 },
      { symbol: 'TSM', name: 'TSMC', marketCap: 700, sector: 'Foundry', relevance: 0.9 },
      { symbol: 'ASML', name: 'ASML', marketCap: 350, sector: 'Equipment', relevance: 0.85 },
      { symbol: 'AMD', name: 'AMD', marketCap: 250, sector: 'CPU/GPU', relevance: 0.8 },
      { symbol: 'INTC', name: 'Intel', marketCap: 120, sector: 'CPU', relevance: 0.75 },
      { symbol: 'AMAT', name: 'Applied Materials', marketCap: 140, sector: 'Equipment', relevance: 0.75 },
      { symbol: 'KLAC', name: 'KLA Corp', marketCap: 80, sector: 'Equipment', relevance: 0.7 },
      { symbol: 'MRVL', name: 'Marvell', marketCap: 60, sector: 'Networking Chips', relevance: 0.65 },
    ],
  },
]

// ─── Inter-Theme Connections ────────────────────────────────────────────────

export const THEME_CONNECTIONS: ThemeConnection[] = [
  { from: 'ai', to: 'semi', type: 'dependency', strength: 0.9 },
  { from: 'ai', to: 'energy', type: 'dependency', strength: 0.6 },
  { from: 'semi', to: 'energy', type: 'dependency', strength: 0.5 },
  { from: 'health', to: 'biotech', type: 'complement', strength: 0.8 },
  { from: 'military', to: 'semi', type: 'dependency', strength: 0.5 },
  { from: 'military', to: 'ai', type: 'dependency', strength: 0.4 },
  { from: 'finance', to: 'ai', type: 'complement', strength: 0.3 },
  { from: 'infra', to: 'energy', type: 'dependency', strength: 0.6 },
  { from: 'esg', to: 'energy', type: 'competitor', strength: 0.5 },
  { from: 'biotech', to: 'health', type: 'complement', strength: 0.8 },
  { from: 'ai', to: 'finance', type: 'complement', strength: 0.3 },
  { from: 'semi', to: 'infra', type: 'dependency', strength: 0.4 },
]

// ─── What-If Scenarios ──────────────────────────────────────────────────────

export const WHAT_IF_SCENARIOS: WhatIfScenario[] = [
  {
    id: 'fed_cuts',
    name: 'Fed cuts rates',
    emoji: '📉',
    description: 'Cheaper capital stimulates tech/AI and growth markets',
    impacts: { ai: 15, semi: 12, finance: 10, health: 5, energy: -5, esg: 8, biotech: 8, infra: 6, military: -3 },
  },
  {
    id: 'recession',
    name: 'Global recession',
    emoji: '📉',
    description: 'Hits cyclical sectors, flight to quality',
    impacts: { ai: -8, semi: -15, finance: -20, health: -5, energy: -25, esg: -10, biotech: -5, infra: -18, military: 5 },
  },
  {
    id: 'trade_war',
    name: 'Trade war',
    emoji: '⚔️',
    description: 'Semiconductor tariffs, supply chains in chaos',
    impacts: { ai: -10, semi: -25, finance: -8, health: -3, energy: -5, esg: -5, biotech: -5, infra: -10, military: 10 },
  },
  {
    id: 'ai_boom',
    name: 'Boom AI 2.0',
    emoji: '🚀',
    description: 'Massive AI adoption powers the entire tech ecosystem',
    impacts: { ai: 30, semi: 25, finance: 8, health: 5, energy: 15, esg: 5, biotech: 10, infra: 12, military: 5 },
  },
  {
    id: 'crypto_crash',
    name: 'Crypto crash',
    emoji: '💥',
    description: 'Capital ucieka of krypto do tradycyjnych assets',
    impacts: { ai: -5, semi: -8, finance: 10, health: 5, energy: 3, esg: 3, biotech: 5, infra: 3, military: 2 },
  },
  {
    id: 'pandemic',
    name: 'Nowa pandemia',
    emoji: '🦠',
    description: 'Wzrost biotech/healthcare, spadek travel/infra',
    impacts: { ai: 5, semi: -5, finance: -10, health: 25, energy: -15, esg: -5, biotech: 30, infra: -20, military: -5 },
  },
]

// ─── Monte Carlo Simulation (Geometric Brownian Motion) ─────────────────────

export function runMonteCarlo(
  currentPrice: number,
  dailyReturn: number,    // expected daily return (e.g. 0.0005 for 0.05%)
  dailyVol: number,       // daily volatility (e.g. 0.02 for 2%)
  horizonDays: number,    // simulation horizon
  numPaths: number = 300,
): MonteCarloResult {
  const dt = 1 // 1 day step
  const paths: number[][] = []

  for (let p = 0; p < numPaths; p++) {
    const path = [currentPrice]
    let price = currentPrice
    for (let d = 1; d < horizonDays; d++) {
      const of = randn()
      const drift = (dailyReturn - 0.5 * dailyVol * dailyVol) * dt
      const diffusion = dailyVol * Math.sqrt(dt) * z
      price = price * Math.exp(drift + diffusion)
      price = Math.max(price, 0.001)
      path.push(price)
    }
    paths.push(path)
  }

  // Compute percentiles at each step
  const median: number[] = []
  const p5: number[] = []
  const p25: number[] = []
  const p75: number[] = []
  const p95: number[] = []

  for (let d = 0; d < horizonDays; d++) {
    const vals = paths.map(p => p[d]).sort((a, b) => a - b)
    median.push(percentile(vals, 50))
    p5.push(percentile(vals, 5))
    p25.push(percentile(vals, 25))
    p75.push(percentile(vals, 75))
    p95.push(percentile(vals, 95))
  }

  // Chance of price going up
  const finalPrices = paths.map(p => p[p.length - 1])
  const chanceUp = finalPrices.filter(p => p > currentPrice).length / finalPrices.length * 100

  return {
    paths,
    median,
    p5,
    p25,
    p75,
    p95,
    currentPrice,
    chanceUp,
    finalMedian: median[median.length - 1],
    horizon: horizonDays,
  }
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// Box-Muller transform for normal distribution
function randn(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

// Compute sentiment from theme changes + scenario impact
export function computeSentiment(
  themeChanges: Record<string, number>,
  activeScenario: WhatIfScenario | null,
): number {
  // Base sentiment from average theme change
  const changes = Object.values(themeChanges)
  const avgChange = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0

  // Map to 0-100 scale (BEAR=0, BULL=100)
  let sentiment = 50 + avgChange * 2

  // Apply scenario impact
  if (activeScenario) {
    const impacts = Object.values(activeScenario.impacts)
    const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length
    sentiment += avgImpact * 0.5
  }

  return Math.max(0, Math.min(100, sentiment))
}

// Estimate daily return and volatility for a company
export function estimateParams(change24h: number, change7d: number): {
  dailyReturn: number
  dailyVol: number
} {
  // Rough estimation from available data
  const dailyReturn = (change24h / 100) / 1 + (change7d / 100) / 7
  // Volatility: scale with absolute change, minimum 1.5% daily
  const dailyVol = Math.max(0.015, Math.abs(change24h / 100) * 0.5 + 0.02)
  return { dailyReturn, dailyVol }
}
