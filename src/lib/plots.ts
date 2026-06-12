import type { PcaLoading, PcaPoint, PcaResult } from './analysis'

export type ComponentKey = 'pc1' | 'pc2' | 'pc3'
export type FigureKind = 'score2d' | 'scree' | 'loadings' | 'biplot'
export type FigureSize = 'single' | 'double' | 'square' | 'wide'
export type DpiScale = 1 | 2

export type FigureOptions = {
  width: number
  height: number
  pcX: ComponentKey
  pcY: ComponentKey
  title: string
  subtitle: string
  caption: string
  showEllipses: boolean
  showCentroids: boolean
  showLabels: boolean
  topLoadings: number
  colors: string[]
}

const margins = { top: 62, right: 28, bottom: 62, left: 68 }
const chiSquare95 = 5.991

export const figureSizes: Record<FigureSize, { label: string; width: number; height: number }> = {
  single: { label: 'Single column', width: 760, height: 560 },
  double: { label: 'Double column', width: 1180, height: 760 },
  square: { label: 'Square', width: 820, height: 820 },
  wide: { label: '16:9', width: 1200, height: 675 },
}

export const componentLabel = (component: ComponentKey) =>
  component.toUpperCase().replace('PC', 'PC')

const escapeXml = (value: string | number) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const pct = (value: number | undefined) =>
  `${(((value ?? 0) * 1000) / 10).toFixed(1)}%`

const pointValue = (point: PcaPoint, component: ComponentKey) => point[component]
const loadingValue = (loading: PcaLoading, component: ComponentKey) =>
  loading[component]

const extent = (values: number[]) => {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return [min - span * 0.12, max + span * 0.12] as const
}

const scale = (
  value: number,
  domain: readonly [number, number],
  range: readonly [number, number],
) => {
  const ratio = (value - domain[0]) / (domain[1] - domain[0] || 1)
  return range[0] + ratio * (range[1] - range[0])
}

const uniqueGroups = (points: PcaPoint[]) => [
  ...new Set(points.map((point) => point.group)),
]

const colorFor = (group: string, groups: string[], colors: string[]) =>
  colors[Math.max(groups.indexOf(group), 0) % colors.length]

const shell = (
  options: FigureOptions,
  inner: string,
) => {
  const { width, height, title, subtitle, caption } = options

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${margins.left}" y="30" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="700" fill="#111827">${escapeXml(title)}</text>
  <text x="${margins.left}" y="52" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#4b5563">${escapeXml(subtitle)}</text>
  ${inner}
  <text x="${margins.left}" y="${height - 24}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#6b7280">${escapeXml(caption)}</text>
</svg>`
}

const grid = (
  x0: number,
  y0: number,
  plotWidth: number,
  plotHeight: number,
) => {
  const parts: string[] = []

  for (let i = 0; i <= 4; i += 1) {
    const x = x0 + (plotWidth * i) / 4
    const y = y0 + (plotHeight * i) / 4
    parts.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + plotHeight}" stroke="#e5e7eb"/>`)
    parts.push(`<line x1="${x0}" y1="${y}" x2="${x0 + plotWidth}" y2="${y}" stroke="#e5e7eb"/>`)
  }

  return parts.join('\n')
}

const axisFrame = (
  x0: number,
  y0: number,
  plotWidth: number,
  plotHeight: number,
) => `<rect x="${x0}" y="${y0}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="#9ca3af" stroke-width="1"/>
  <line x1="${x0}" y1="${y0 + plotHeight}" x2="${x0 + plotWidth}" y2="${y0 + plotHeight}" stroke="#111827" stroke-width="2.2"/>
  <line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 + plotHeight}" stroke="#111827" stroke-width="2.2"/>`

const covarianceEllipse = (
  points: PcaPoint[],
  pcX: ComponentKey,
  pcY: ComponentKey,
  xDomain: readonly [number, number],
  yDomain: readonly [number, number],
  frame: { x0: number; y0: number; width: number; height: number },
  fill: string,
) => {
  if (points.length < 3) return ''

  const xs = points.map((point) => pointValue(point, pcX))
  const ys = points.map((point) => pointValue(point, pcY))
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let sxx = 0
  let syy = 0
  let sxy = 0

  points.forEach((point) => {
    const dx = pointValue(point, pcX) - mx
    const dy = pointValue(point, pcY) - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  })

  sxx /= points.length - 1
  syy /= points.length - 1
  sxy /= points.length - 1

  const trace = sxx + syy
  const determinant = sxx * syy - sxy * sxy
  const root = Math.sqrt(Math.max(0, (trace * trace) / 4 - determinant))
  const lambda1 = trace / 2 + root
  const lambda2 = trace / 2 - root
  const angle = (Math.atan2(2 * sxy, sxx - syy) / 2) * (180 / Math.PI)
  const cx = scale(mx, xDomain, [frame.x0, frame.x0 + frame.width])
  const cy = scale(my, yDomain, [frame.y0 + frame.height, frame.y0])
  const xUnits = frame.width / (xDomain[1] - xDomain[0] || 1)
  const yUnits = frame.height / (yDomain[1] - yDomain[0] || 1)
  const rx = Math.sqrt(Math.max(lambda1, 0) * chiSquare95) * xUnits
  const ry = Math.sqrt(Math.max(lambda2, 0) * chiSquare95) * yUnits

  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx === 0 || ry === 0) {
    return ''
  }

  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${-angle} ${cx} ${cy})" fill="${fill}" fill-opacity="0.12" stroke="${fill}" stroke-opacity="0.72" stroke-width="1.8"/>`
}

const legend = (
  points: PcaPoint[],
  colors: string[],
  x: number,
  y: number,
) => {
  const groups = uniqueGroups(points)
  return groups
    .map((group, index) => {
      const yPos = y + index * 21
      return `<g>
        <circle cx="${x}" cy="${yPos}" r="4.5" fill="${colorFor(group, groups, colors)}"/>
        <text x="${x + 13}" y="${yPos + 4}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#374151">${escapeXml(group)}</text>
      </g>`
    })
    .join('\n')
}

export const renderScore2dSvg = (result: PcaResult, options: FigureOptions) => {
  const { width, height, pcX, pcY, colors } = options
  const plotWidth = width - margins.left - margins.right - 150
  const plotHeight = height - margins.top - margins.bottom
  const x0 = margins.left
  const y0 = margins.top
  const xDomain = extent(result.points.map((point) => pointValue(point, pcX)))
  const yDomain = extent(result.points.map((point) => pointValue(point, pcY)))
  const frame = { x0, y0, width: plotWidth, height: plotHeight }
  const groups = uniqueGroups(result.points)
  const ellipses = options.showEllipses
    ? groups
        .map((group) =>
          covarianceEllipse(
            result.points.filter((point) => point.group === group),
            pcX,
            pcY,
            xDomain,
            yDomain,
            frame,
            colorFor(group, groups, colors),
          ),
        )
        .join('\n')
    : ''
  const centroids = options.showCentroids
    ? groups
        .map((group) => {
          const points = result.points.filter((point) => point.group === group)
          const x =
            points.reduce((total, point) => total + pointValue(point, pcX), 0) /
            points.length
          const y =
            points.reduce((total, point) => total + pointValue(point, pcY), 0) /
            points.length
          return `<rect x="${scale(x, xDomain, [x0, x0 + plotWidth]) - 5}" y="${scale(y, yDomain, [y0 + plotHeight, y0]) - 5}" width="10" height="10" transform="rotate(45 ${scale(x, xDomain, [x0, x0 + plotWidth])} ${scale(y, yDomain, [y0 + plotHeight, y0])})" fill="${colorFor(group, groups, colors)}" stroke="#111827" stroke-width="1"/>`
        })
        .join('\n')
    : ''
  const points = result.points
    .map((point) => {
      const x = scale(pointValue(point, pcX), xDomain, [x0, x0 + plotWidth])
      const y = scale(pointValue(point, pcY), yDomain, [y0 + plotHeight, y0])
      return `<g>
        <circle cx="${x}" cy="${y}" r="4.8" fill="${colorFor(point.group, groups, colors)}" stroke="#ffffff" stroke-width="1"/>
        ${options.showLabels ? `<text x="${x + 7}" y="${y - 7}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#111827">${escapeXml(point.sample)}</text>` : ''}
      </g>`
    })
    .join('\n')
  const xLabel = `${componentLabel(pcX)} (${pct(result.explained[Number(pcX.slice(2)) - 1])})`
  const yLabel = `${componentLabel(pcY)} (${pct(result.explained[Number(pcY.slice(2)) - 1])})`

  return shell(
    options,
    `<g>
      ${grid(x0, y0, plotWidth, plotHeight)}
      ${ellipses}
      ${points}
      ${centroids}
      ${axisFrame(x0, y0, plotWidth, plotHeight)}
      <text x="${x0 + plotWidth / 2}" y="${height - 42}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" fill="#111827">${xLabel}</text>
      <text x="24" y="${y0 + plotHeight / 2}" transform="rotate(-90 24 ${y0 + plotHeight / 2})" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" fill="#111827">${yLabel}</text>
      ${legend(result.points, colors, width - 132, y0 + 10)}
    </g>`,
  )
}

export const renderScreeSvg = (result: PcaResult, options: FigureOptions) => {
  const values = result.allExplained.slice(0, Math.min(10, result.allExplained.length))
  const cumulative = result.allCumulative.slice(0, values.length)
  const bottomMargin = 86
  const plotWidth = options.width - margins.left - margins.right
  const plotHeight = options.height - margins.top - bottomMargin
  const x0 = margins.left
  const y0 = margins.top
  const barWidth = plotWidth / values.length
  const bars = values
    .map((value, index) => {
      const x = x0 + index * barWidth + 8
      const h = value * plotHeight
      return `<rect x="${x}" y="${y0 + plotHeight - h}" width="${Math.max(12, barWidth - 16)}" height="${h}" fill="#2563eb" opacity="0.82"/>
      <text x="${x + (barWidth - 16) / 2}" y="${y0 + plotHeight + 20}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#374151">PC${index + 1}</text>`
    })
    .join('\n')
  const line = cumulative
    .map((value, index) => {
      const x = x0 + index * barWidth + barWidth / 2
      const y = y0 + plotHeight - value * plotHeight
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
  const dots = cumulative
    .map((value, index) => {
      const x = x0 + index * barWidth + barWidth / 2
      const y = y0 + plotHeight - value * plotHeight
      return `<circle cx="${x}" cy="${y}" r="4" fill="#f97316"/>`
    })
    .join('\n')

  return shell(
    options,
    `<g>
      ${grid(x0, y0, plotWidth, plotHeight)}
      ${bars}
      <path d="${line}" fill="none" stroke="#f97316" stroke-width="2.2"/>
      ${dots}
      ${axisFrame(x0, y0, plotWidth, plotHeight)}
      <text x="${x0 + plotWidth / 2}" y="${options.height - 42}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" fill="#111827">Principal components</text>
      <text x="24" y="${y0 + plotHeight / 2}" transform="rotate(-90 24 ${y0 + plotHeight / 2})" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" fill="#111827">Explained variance</text>
      <text x="${options.width - margins.right - 8}" y="${y0 + 18}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#f97316">Cumulative variance</text>
    </g>`,
  )
}

export const renderLoadingsSvg = (result: PcaResult, options: FigureOptions) => {
  const top = result.loadings.slice(0, options.topLoadings)
  const plotWidth = options.width - margins.left - margins.right - 120
  const rowHeight = Math.min(34, (options.height - margins.top - margins.bottom) / top.length)
  const x0 = margins.left + 110
  const y0 = margins.top + 4
  const max = Math.max(...top.map((loading) => loading.contribution), 0.01)
  const rows = top
    .map((loading, index) => {
      const y = y0 + index * rowHeight
      const width = (loading.contribution / max) * plotWidth
      return `<g>
        <text x="${margins.left}" y="${y + rowHeight * 0.62}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#111827">${escapeXml(loading.feature)}</text>
        <rect x="${x0}" y="${y + 6}" width="${width}" height="${rowHeight - 12}" rx="2" fill="#089981" opacity="0.82"/>
        <text x="${x0 + width + 8}" y="${y + rowHeight * 0.62}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#4b5563">${loading.contribution.toFixed(3)}</text>
      </g>`
    })
    .join('\n')

  return shell(
    options,
    `<g>
      ${rows}
      <text x="${x0}" y="${options.height - 42}" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" fill="#111827">Top variable contribution across PC1-PC3</text>
    </g>`,
  )
}

export const renderBiplotSvg = (result: PcaResult, options: FigureOptions) => {
  const base = renderScore2dSvg(result, { ...options, showLabels: false })
  const plotWidth = options.width - margins.left - margins.right - 150
  const plotHeight = options.height - margins.top - margins.bottom
  const x0 = margins.left
  const y0 = margins.top
  const xDomain = extent(result.points.map((point) => pointValue(point, options.pcX)))
  const yDomain = extent(result.points.map((point) => pointValue(point, options.pcY)))
  const centerX = scale(0, xDomain, [x0, x0 + plotWidth])
  const centerY = scale(0, yDomain, [y0 + plotHeight, y0])
  const radius = Math.min(plotWidth, plotHeight) * 0.3
  const maxLoading = Math.max(
    ...result.loadings
      .slice(0, options.topLoadings)
      .map((loading) =>
        Math.hypot(loadingValue(loading, options.pcX), loadingValue(loading, options.pcY)),
      ),
    0.01,
  )
  const vectors = result.loadings
    .slice(0, options.topLoadings)
    .map((loading) => {
      const x =
        centerX + (loadingValue(loading, options.pcX) / maxLoading) * radius
      const y =
        centerY - (loadingValue(loading, options.pcY) / maxLoading) * radius
      return `<g>
        <line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" stroke="#dc2626" stroke-width="1.5" marker-end="url(#arrow)"/>
        <text x="${x + 5}" y="${y - 5}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#991b1b">${escapeXml(loading.feature)}</text>
      </g>`
    })
    .join('\n')

  return base
    .replace('<svg ', '<svg ')
    .replace(
      '</svg>',
      `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#dc2626"/></marker></defs>${vectors}</svg>`,
    )
}
