import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  FileText,
  Play,
  RefreshCw,
  Rotate3D,
  Settings2,
  Shapes,
  Tags,
} from 'lucide-react'
import './App.css'
import {
  buildGroupMap,
  parseGroupTable,
  parseQuantTable,
  pickDefaultColumn,
  runPca,
  scoresToCsv,
  type GroupTable,
  type Orientation,
  type PcaResult,
  type ScalingMethod,
} from './lib/analysis'
import {
  figureSizes,
  renderBiplotSvg,
  renderLoadingsSvg,
  renderScore2dSvg,
  renderScreeSvg,
  type ComponentKey,
  type DpiScale,
  type FigureKind,
  type FigureOptions,
  type FigureSize,
} from './lib/plots'

type PlotPreset = 'classic' | 'omics-qc' | 'ellipsoid' | 'minimal'
type ShapeColumn = 'none' | string
type LegendOrientation = 'h' | 'v'
type LegendPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type ControlTab = 'data' | 'analysis' | 'visual' | 'export'
type ResultView = 'threeD' | 'figure' | 'methods'

type PointShape = 'circle' | 'square' | 'diamond' | 'cross' | 'x'
type PlotExportState = {
  traces: unknown[]
  layout: Record<string, unknown>
}

const pointShapes: PointShape[] = ['circle', 'square', 'diamond', 'cross', 'x']
const minSamplesFor2dEllipse = 3
const minSamplesFor3dEllipsoid = 4
const chiSquare95Df3 = 7.814727903

const controlTabs: Array<{
  value: ControlTab
  label: string
  icon: React.ReactNode
}> = [
  { value: 'data', label: '数据', icon: <Download size={15} /> },
  { value: 'analysis', label: '分析', icon: <Settings2 size={15} /> },
  { value: 'visual', label: '图形', icon: <Shapes size={15} /> },
  { value: 'export', label: '导出', icon: <FileText size={15} /> },
]

const resultViews: Array<{
  value: ResultView
  label: string
  icon: React.ReactNode
}> = [
  { value: 'threeD', label: '3D PCA', icon: <BarChart3 size={15} /> },
  { value: 'figure', label: '发表图', icon: <FileText size={15} /> },
  { value: 'methods', label: '方法学', icon: <Settings2 size={15} /> },
]

const componentOptions: Array<{ value: ComponentKey; label: string }> = [
  { value: 'pc1', label: 'PC1' },
  { value: 'pc2', label: 'PC2' },
  { value: 'pc3', label: 'PC3' },
]

const mainCamera = { eye: { x: 1.42, y: 1.34, z: 0.95 } }

const legendOrientationOptions: Array<{
  value: LegendOrientation
  label: string
}> = [
  { value: 'h', label: '横向' },
  { value: 'v', label: '纵向' },
]

const legendPositionOptions: Array<{
  value: LegendPosition
  label: string
}> = [
  { value: 'top-left', label: '左上' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-right', label: '右下' },
]

const figureKindOptions: Array<{ value: FigureKind; label: string }> = [
  { value: 'score2d', label: '2D PCA score' },
  { value: 'scree', label: 'Scree plot' },
  { value: 'loadings', label: 'Top loadings' },
  { value: 'biplot', label: 'Biplot' },
]

const scalingMethodOptions: Array<{
  value: ScalingMethod
  label: string
  description: string
}> = [
  {
    value: 'center',
    label: 'Mean-centering / no variance scaling',
    description: 'PCA 前每个特征减去均值，不再按方差缩放；适合希望保留原始方差权重的数据。',
  },
  {
    value: 'autoscale',
    label: 'Autoscaling / UV',
    description: '减均值后除以标准差；适合不同量纲或高低丰度差异很大的特征。',
  },
  {
    value: 'pareto',
    label: 'Pareto scaling',
    description: '减均值后除以标准差平方根；常用于组学数据，是不过度放大小方差特征的折中方案。',
  },
  {
    value: 'range',
    label: 'Range scaling',
    description: '减均值后除以最大最小范围；可比较不同范围的特征，但对极端值更敏感。',
  },
]

const defaultFigureTitles: Record<FigureKind, string> = {
  score2d: '2D PCA score plot',
  scree: 'Scree plot',
  loadings: 'Top PCA loadings',
  biplot: 'PCA biplot',
}

const defaultFigureCaptions: Record<FigureKind, string> = {
  score2d:
    `Points show sample PCA scores; optional ellipses show approximate 95% normal score regions for groups with at least ${minSamplesFor2dEllipse} samples.`,
  scree: 'Bars show per-component variance; orange line shows cumulative variance.',
  loadings: 'Bars rank variables by summed loading contribution across PC1-PC3.',
  biplot: 'Red vectors indicate top contributing variables in the selected PC plane.',
}

const defaultSubtitleForScaling = (method: ScalingMethod) => {
  if (method === 'center') return 'Mean-centered PCA without variance scaling'
  if (method === 'autoscale') return 'Centered PCA with autoscaling'
  if (method === 'pareto') return 'Centered PCA with Pareto scaling'
  return 'Centered PCA with range scaling'
}

let plotlyPromise: Promise<typeof import('plotly.js-dist-min').default> | null =
  null

const getPlotly = () => {
  plotlyPromise ??= import('plotly.js-dist-min').then((module) => module.default)
  return plotlyPromise
}

const exampleQuant = `Feature,S01,S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S12,S13,S14,S15,S16,S17,S18,S19,S20,S21,S22,S23,S24
GeneA,11.2,10.8,12.1,11.5,10.9,12.4,28.2,29.5,27.4,28.8,30.1,27.9,14.8,15.5,14.2,15.1,16.0,14.5,34.5,33.7,35.1,34.1,36.0,33.2
GeneB,6.5,7.1,6.8,6.9,7.3,6.2,18.4,17.9,19.1,18.7,17.5,19.5,8.2,8.7,8.1,8.5,9.0,7.9,21.6,22.4,20.9,21.8,22.9,20.5
GeneC,42.1,40.8,41.5,41.9,40.2,42.7,16.4,15.9,17.2,16.8,15.4,17.6,36.3,35.7,37.2,36.8,35.2,37.6,19.6,18.8,20.1,19.3,20.5,18.4
GeneD,3.2,3.4,3.1,3.3,3.5,3.0,8.9,9.2,8.6,9.0,9.5,8.4,22.5,23.4,21.8,22.9,23.8,21.5,27.1,28.2,26.6,27.5,28.7,26.2
GeneE,72.1,71.5,73.4,72.8,70.9,73.9,69.2,70.1,68.7,69.6,70.8,68.2,19.4,20.1,18.9,19.8,20.5,18.5,24.6,23.7,25.2,24.1,25.8,23.4
GeneF,18.4,17.9,18.8,18.1,17.5,19.2,31.6,32.1,30.7,31.2,32.8,30.4,12.4,13.1,12.0,12.7,13.5,11.8,44.2,43.8,45.1,44.6,45.8,43.2
GeneG,5.2,5.5,4.9,5.3,5.7,4.8,6.1,6.4,5.8,6.2,6.7,5.6,31.4,30.8,32.1,31.7,30.4,32.6,35.3,36.0,34.8,35.7,36.5,34.4
GeneH,25.4,24.9,26.1,25.7,24.5,26.5,11.3,10.8,11.9,11.5,10.5,12.2,29.6,28.7,30.2,29.1,28.4,30.6,12.4,13.0,11.8,12.7,13.4,11.5`

const exampleGroups = `Sample,Group,Batch
S01,Control,B1
S02,Control,B1
S03,Control,B2
S04,Control,B2
S05,Control,B1
S06,Control,B2
S07,Treatment A,B1
S08,Treatment A,B1
S09,Treatment A,B2
S10,Treatment A,B2
S11,Treatment A,B1
S12,Treatment A,B2
S13,Treatment B,B1
S14,Treatment B,B2
S15,Treatment B,B2
S16,Treatment B,B1
S17,Treatment B,B1
S18,Treatment B,B2
S19,Combo,B1
S20,Combo,B2
S21,Combo,B2
S22,Combo,B1
S23,Combo,B1
S24,Combo,B2`

const colors = [
  '#2563eb',
  '#d94625',
  '#089981',
  '#b45309',
  '#7c3aed',
  '#db2777',
  '#475569',
  '#16a34a',
]

const presetStyle = {
  classic: {
    markerSize: 6,
    markerOpacity: 0.92,
    gridColor: '#d8dee8',
    axisColor: '#64748b',
    chartBackground:
      'linear-gradient(90deg, rgb(37 99 235 / 0.05), transparent 38%), linear-gradient(140deg, transparent, rgb(8 153 129 / 0.07)), #ffffff',
  },
  'omics-qc': {
    markerSize: 6,
    markerOpacity: 0.82,
    gridColor: '#dfe7f2',
    axisColor: '#475569',
    chartBackground: '#fbfdff',
  },
  ellipsoid: {
    markerSize: 6,
    markerOpacity: 0.9,
    gridColor: '#d8dee8',
    axisColor: '#475569',
    chartBackground:
      'linear-gradient(140deg, rgb(37 99 235 / 0.05), rgb(8 153 129 / 0.06)), #ffffff',
  },
  minimal: {
    markerSize: 7,
    markerOpacity: 0.95,
    gridColor: '#edf2f7',
    axisColor: '#94a3b8',
    chartBackground: '#ffffff',
  },
} satisfies Record<
  PlotPreset,
  {
    markerSize: number
    markerOpacity: number
    gridColor: string
    axisColor: string
    chartBackground: string
  }
>

const defaultPlotPreset: PlotPreset = 'ellipsoid'

const formatPercent = (value: number | undefined) =>
  `${(((value ?? 0) * 1000) / 10).toFixed(1)}%`

const readFile = async (
  event: React.ChangeEvent<HTMLInputElement>,
  onRead: (text: string, filename: string) => void,
  onError: (message: string, filename: string) => void,
) => {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    onRead(await file.text(), file.name)
  } catch (error) {
    onError(
      error instanceof Error ? error.message : '浏览器无法读取该文件。',
      file.name,
    )
  } finally {
    event.target.value = ''
  }
}

const downloadText = (filename: string, text: string) => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const downloadSvg = (filename: string, svg: string) => {
  downloadText(filename, svg)
}

const downloadSvgAsPng = async (filename: string, svg: string) => {
  const width = Number(svg.match(/width="(\d+)"/)?.[1] ?? 1200)
  const height = Number(svg.match(/height="(\d+)"/)?.[1] ?? 900)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const image = new Image()

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = reject
    image.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    URL.revokeObjectURL(url)
    throw new Error('Canvas export is not available in this browser.')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  URL.revokeObjectURL(url)

  const pngUrl = canvas.toDataURL('image/png')
  const link = document.createElement('a')
  link.href = pngUrl
  link.download = filename
  link.click()
}

const downloadDataUrl = (filename: string, url: string) => {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
}

const scalingMethodText: Record<ScalingMethod, string> = {
  center:
    'features were mean-centered without variance scaling (x - mean), so the original variance structure was retained',
  autoscale:
    'features were autoscaled to unit variance by subtracting the feature mean and dividing by the feature standard deviation',
  pareto:
    'features were Pareto-scaled by subtracting the feature mean and dividing by the square root of the feature standard deviation',
  range:
    'features were range-scaled by subtracting the feature mean and dividing by the feature range',
}

const scalingMethodTextZh: Record<ScalingMethod, string> = {
  center: '对每个特征进行均值中心化处理，即减去该特征均值，不进行方差缩放，从而保留原始方差权重',
  autoscale: '对每个特征进行 autoscaling / unit variance scaling，即减去该特征均值并除以该特征标准差',
  pareto: '对每个特征进行 Pareto scaling，即减去该特征均值并除以该特征标准差的平方根',
  range: '对每个特征进行 range scaling，即减去该特征均值并除以该特征的最大最小范围',
}

const generateMethodsTexts = ({
  result,
  orientation,
  sampleColumn,
  groupColumn,
  shapeColumn,
  showEllipsoids,
  showFigureEllipses,
  showCentroids,
  show3dLabels,
  showFigureLabels,
}: {
  result: PcaResult
  orientation: Orientation
  sampleColumn: string
  groupColumn: string
  shapeColumn: string
  showEllipsoids: boolean
  showFigureEllipses: boolean
  showCentroids: boolean
  show3dLabels: boolean
  showFigureLabels: boolean
}) => {
  const orientationText =
    orientation === 'samples-as-columns'
      ? 'samples in columns and features in rows'
      : 'samples in rows and features in columns'
  const orientationTextZh =
    orientation === 'samples-as-columns'
      ? '样本在列、特征在行'
      : '样本在行、特征在列'
  const transformText = result.options.logTransform
    ? 'Values were transformed as log2(x + 1) before PCA; this option requires non-negative input values.'
    : 'No logarithmic transformation was applied before PCA.'
  const transformTextZh = result.options.logTransform
    ? 'PCA 前对输入数值进行 log2(x + 1) 转换；该转换要求输入值不小于 0。'
    : 'PCA 前未进行对数转换。'
  const skippedText =
    result.skippedFeatures > 0
      ? ` ${result.skippedFeatures} feature(s) containing non-numeric values were excluded.`
      : ''
  const skippedTextZh =
    result.skippedFeatures > 0
      ? ` 含非数值单元的 ${result.skippedFeatures} 个特征已被排除。`
      : ''
  const zeroVarianceText =
    result.zeroVarianceFeatures > 0
      ? ` ${result.zeroVarianceFeatures} zero-variance feature(s) were removed after preprocessing.`
      : ''
  const zeroVarianceTextZh =
    result.zeroVarianceFeatures > 0
      ? ` 预处理后零方差的 ${result.zeroVarianceFeatures} 个特征已被移除。`
      : ''
  const layerText = [
    `samples were colored by ${groupColumn}`,
    shapeColumn !== 'none' ? `marker shapes encoded ${shapeColumn}` : null,
    showEllipsoids
      ? '3D approximate 95% normal score ellipsoids were shown for groups with sufficient sample size'
      : null,
    showFigureEllipses
      ? 'static 2D score ellipses were shown for groups with sufficient sample size'
      : null,
    showCentroids ? 'group centroids were marked' : null,
    show3dLabels ? 'sample labels were displayed in the 3D plot' : null,
    showFigureLabels ? 'sample labels were displayed in the static 2D score plot' : null,
  ]
    .filter(Boolean)
    .join('; ')
  const layerTextZh = [
    `样本颜色表示 ${groupColumn} 分组`,
    shapeColumn !== 'none' ? `点形状表示 ${shapeColumn}` : null,
    showEllipsoids ? '3D 图对样本量足够的分组显示近似 95% 正态得分椭球' : null,
    showFigureEllipses ? '2D 静态图对样本量足够的分组显示近似 95% 正态得分椭圆' : null,
    showCentroids ? '标记各组质心' : null,
    show3dLabels ? '3D 图显示样本标签' : null,
    showFigureLabels ? '2D 静态得分图显示样本标签' : null,
  ]
    .filter(Boolean)
    .join('；')
  const regionMethodText = [
    showFigureEllipses
      ? `Static 2D score ellipses represent approximate normal score regions rather than confidence intervals for group means, and require at least ${minSamplesFor2dEllipse} samples per displayed group.`
      : 'Static 2D score ellipses were not displayed.',
    showEllipsoids
      ? `Full covariance-based 3D score ellipsoids require at least ${minSamplesFor3dEllipsoid} samples per displayed group.`
      : '3D score ellipsoids were not displayed.',
  ].join(' ')
  const regionMethodTextZh = [
    showFigureEllipses
      ? `2D 静态图中的椭圆表示近似正态得分分布区域，并不是分组均值的置信区间；每个显示分组至少需要 ${minSamplesFor2dEllipse} 个样本。`
      : '2D 静态图未显示分组得分椭圆。',
    showEllipsoids
      ? `基于完整协方差矩阵的 3D 得分椭球每个显示分组至少需要 ${minSamplesFor3dEllipsoid} 个样本。`
      : '3D 图未显示分组得分椭球。',
  ].join('')

  return {
    en: `Principal component analysis (PCA) was performed in PCA Figure Studio on a sample-by-feature matrix parsed from the uploaded quantitative table (${orientationText}). The analysis included ${result.sampleCount} samples and ${result.featureCount} retained numeric features.${skippedText}${zeroVarianceText} ${transformText} Before decomposition, ${scalingMethodText[result.options.scalingMethod]}. PCA was computed by singular value decomposition of the preprocessed matrix. The first three principal components explained ${formatPercent(result.explained[0])}, ${formatPercent(result.explained[1])}, and ${formatPercent(result.explained[2])} of the variance, respectively (${formatPercent(result.cumulative[2])} cumulative). Sample groups were read from the uploaded metadata table using "${sampleColumn}" as the sample identifier and "${groupColumn}" as the grouping column. In the PCA visualization, ${layerText}. ${regionMethodText}`,
    zh: `主成分分析（PCA）在 PCA Figure Studio 中完成。上传的定量表格被解析为样本 × 特征矩阵（${orientationTextZh}）。本次分析包含 ${result.sampleCount} 个样本和 ${result.featureCount} 个保留的数值特征。${skippedTextZh}${zeroVarianceTextZh}${transformTextZh} 分解前，${scalingMethodTextZh[result.options.scalingMethod]}。PCA 基于预处理后的矩阵通过奇异值分解（singular value decomposition, SVD）计算。前三个主成分分别解释 ${formatPercent(result.explained[0])}、${formatPercent(result.explained[1])} 和 ${formatPercent(result.explained[2])} 的方差，累计解释方差为 ${formatPercent(result.cumulative[2])}。样本分组信息来自上传的元数据表，其中 "${sampleColumn}" 作为样本标识列，"${groupColumn}" 作为分组列。PCA 可视化中，${layerTextZh}。${regionMethodTextZh}`,
  }
}

const groupRowsBySample = (
  table: GroupTable | null,
  sampleColumn: string,
) => {
  const rows = new Map<string, Record<string, string>>()
  if (!table) return rows

  for (const row of table.rows) {
    const sample = String(row[sampleColumn] ?? '').trim()
    if (sample) rows.set(sample, row)
  }

  return rows
}

const mean = (values: number[]) =>
  values.reduce((total, value) => total + value, 0) / values.length

const buildEllipsoidSurface = (
  points: Array<{ pc1: number; pc2: number; pc3: number }>,
  scale = Math.sqrt(chiSquare95Df3),
) => {
  if (points.length < minSamplesFor3dEllipsoid) return null

  const center = {
    pc1: mean(points.map((point) => point.pc1)),
    pc2: mean(points.map((point) => point.pc2)),
    pc3: mean(points.map((point) => point.pc3)),
  }
  const covariance = buildCovarianceMatrix(points, center)
  const eigen = eigenDecomposition3x3(covariance)
  if (!eigen) return null

  const radii = eigen.values.map((value) => Math.sqrt(Math.max(value, 0)) * scale)
  if (radii.some((value) => !Number.isFinite(value) || value <= 1e-8)) {
    return null
  }

  const thetaSteps = 28
  const phiSteps = 14
  const x: number[][] = []
  const y: number[][] = []
  const z: number[][] = []

  for (let phiIndex = 0; phiIndex <= phiSteps; phiIndex += 1) {
    const phi = (-Math.PI / 2) + (Math.PI * phiIndex) / phiSteps
    const rowX: number[] = []
    const rowY: number[] = []
    const rowZ: number[] = []

    for (let thetaIndex = 0; thetaIndex <= thetaSteps; thetaIndex += 1) {
      const theta = (2 * Math.PI * thetaIndex) / thetaSteps
      const local = [
        radii[0] * Math.cos(phi) * Math.cos(theta),
        radii[1] * Math.cos(phi) * Math.sin(theta),
        radii[2] * Math.sin(phi),
      ]
      const rotated = multiplyMatrixVector(eigen.vectors, local)
      rowX.push(center.pc1 + rotated[0])
      rowY.push(center.pc2 + rotated[1])
      rowZ.push(center.pc3 + rotated[2])
    }

    x.push(rowX)
    y.push(rowY)
    z.push(rowZ)
  }

  return { x, y, z, center }
}

const buildCovarianceMatrix = (
  points: Array<{ pc1: number; pc2: number; pc3: number }>,
  center: { pc1: number; pc2: number; pc3: number },
) => {
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const denominator = points.length - 1

  points.forEach((point) => {
    const delta = [
      point.pc1 - center.pc1,
      point.pc2 - center.pc2,
      point.pc3 - center.pc3,
    ]
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        covariance[row][column] += (delta[row] * delta[column]) / denominator
      }
    }
  })

  return covariance
}

const multiplyMatrixVector = (matrix: number[][], vector: number[]) =>
  matrix.map((row) =>
    row.reduce((total, value, index) => total + value * vector[index], 0),
  )

const eigenDecomposition3x3 = (matrix: number[][]) => {
  const valuesMatrix = matrix.map((row) => [...row])
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  for (let iteration = 0; iteration < 60; iteration += 1) {
    let p = 0
    let q = 1
    let max = Math.abs(valuesMatrix[p][q])

    for (let row = 0; row < 3; row += 1) {
      for (let column = row + 1; column < 3; column += 1) {
        const value = Math.abs(valuesMatrix[row][column])
        if (value > max) {
          max = value
          p = row
          q = column
        }
      }
    }

    if (max < 1e-10) break

    const app = valuesMatrix[p][p]
    const aqq = valuesMatrix[q][q]
    const apq = valuesMatrix[p][q]
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app)
    const c = Math.cos(angle)
    const s = Math.sin(angle)

    for (let index = 0; index < 3; index += 1) {
      const aip = valuesMatrix[index][p]
      const aiq = valuesMatrix[index][q]
      valuesMatrix[index][p] = c * aip - s * aiq
      valuesMatrix[index][q] = s * aip + c * aiq
    }

    for (let index = 0; index < 3; index += 1) {
      const api = valuesMatrix[p][index]
      const aqi = valuesMatrix[q][index]
      valuesMatrix[p][index] = c * api - s * aqi
      valuesMatrix[q][index] = s * api + c * aqi
    }

    for (let index = 0; index < 3; index += 1) {
      const vip = vectors[index][p]
      const viq = vectors[index][q]
      vectors[index][p] = c * vip - s * viq
      vectors[index][q] = s * vip + c * viq
    }
  }

  const eigenPairs = [0, 1, 2]
    .map((index) => ({
      value: valuesMatrix[index][index],
      vector: vectors.map((row) => row[index]),
    }))
    .sort((a, b) => b.value - a.value)

  if (eigenPairs.some((pair) => pair.value <= 1e-10)) return null

  return {
    values: eigenPairs.map((pair) => pair.value),
    vectors: [0, 1, 2].map((row) => eigenPairs.map((pair) => pair.vector[row])),
  }
}

const paddedRange = (values: number[]) => {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const padding = span * 0.12

  return [min - padding, max + padding] as const
}

const legendLayout = (
  position: LegendPosition,
  orientation: LegendOrientation,
  articleMode: boolean,
) => {
  const verticalPadding = articleMode ? 0.04 : 0.02
  const positions: Record<
    LegendPosition,
    { x: number; y: number; xanchor: 'left' | 'right'; yanchor: 'top' | 'bottom' }
  > = {
    'top-left': {
      x: 0.02,
      y: 1 - verticalPadding,
      xanchor: 'left',
      yanchor: 'top',
    },
    'top-right': {
      x: 0.98,
      y: 1 - verticalPadding,
      xanchor: 'right',
      yanchor: 'top',
    },
    'bottom-left': {
      x: 0.02,
      y: verticalPadding,
      xanchor: 'left',
      yanchor: 'bottom',
    },
    'bottom-right': {
      x: 0.98,
      y: verticalPadding,
      xanchor: 'right',
      yanchor: 'bottom',
    },
  }

  return {
    orientation,
    ...positions[position],
    itemwidth: orientation === 'h' ? (articleMode ? 44 : 32) : undefined,
    font: { size: articleMode ? 16 : 12, color: '#334155' },
  }
}

const cubeFrameTrace = (
  xRange: readonly [number, number],
  yRange: readonly [number, number],
  zRange: readonly [number, number],
  color: string,
  width: number,
) => {
  const [xMin, xMax] = xRange
  const [yMin, yMax] = yRange
  const [zMin, zMax] = zRange
  const corners = [
    [xMin, yMin, zMin],
    [xMax, yMin, zMin],
    [xMax, yMax, zMin],
    [xMin, yMax, zMin],
    [xMin, yMin, zMax],
    [xMax, yMin, zMax],
    [xMax, yMax, zMax],
    [xMin, yMax, zMax],
  ] as const
  const edges = [
    [1, 2],
    [2, 3],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const
  const x: Array<number | null> = []
  const y: Array<number | null> = []
  const z: Array<number | null> = []

  edges.forEach(([start, end]) => {
    x.push(corners[start][0], corners[end][0], null)
    y.push(corners[start][1], corners[end][1], null)
    z.push(corners[start][2], corners[end][2], null)
  })

  return {
    type: 'scatter3d',
    mode: 'lines',
    name: 'Cube frame',
    x,
    y,
    z,
    line: { color, width },
    hoverinfo: 'skip',
    showlegend: false,
  }
}

const PanelTitle = ({
  icon,
  title,
}: {
  icon: React.ReactNode
  title: string
}) => (
  <div className="panel-title">
    <span className="panel-icon">{icon}</span>
    <h2>{title}</h2>
  </div>
)

const FileDrop = ({
  label,
  description,
  source,
  meta,
  detail,
  state = 'ready',
  onRead,
  onError,
}: {
  label: string
  description: string
  source: string
  meta: string
  detail?: string
  state?: 'ready' | 'empty' | 'error'
  onRead: (text: string, filename: string) => void
  onError: (message: string, filename: string) => void
}) => (
  <label className={`file-drop file-drop-${state}`}>
    <span className="file-drop-icon">
      <Download size={18} aria-hidden="true" />
    </span>
    <span className="file-drop-body">
      <span className="file-drop-heading">
        <strong>{label}</strong>
        <em>{state === 'empty' ? '未载入' : state === 'error' ? '需检查' : '已载入'}</em>
      </span>
      <small>{description}</small>
      <span className="file-drop-status">当前：{source}</span>
      <span className="file-drop-meta">{meta}</span>
      {detail ? <span className="file-drop-detail">{detail}</span> : null}
    </span>
    <input
      type="file"
      accept=".csv,.tsv,.txt"
      onChange={(event) => void readFile(event, onRead, onError)}
    />
  </label>
)

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="stat">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

const App = () => {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const plotExportRef = useRef<PlotExportState | null>(null)
  const [quantText, setQuantText] = useState(exampleQuant)
  const [groupText, setGroupText] = useState(exampleGroups)
  const [quantSourceName, setQuantSourceName] = useState('内置示例矩阵')
  const [groupSourceName, setGroupSourceName] = useState('内置示例分组')
  const [quantUploadError, setQuantUploadError] = useState('')
  const [groupUploadError, setGroupUploadError] = useState('')
  const [orientation, setOrientation] =
    useState<Orientation>('samples-as-columns')
  const [logTransform, setLogTransform] = useState(false)
  const [scalingMethod, setScalingMethod] =
    useState<ScalingMethod>('autoscale')
  const [sampleColumn, setSampleColumn] = useState('Sample')
  const [groupColumn, setGroupColumn] = useState('Group')
  const plotPreset = defaultPlotPreset
  const [showEllipsoids, setShowEllipsoids] = useState(true)
  const [showCentroids, setShowCentroids] = useState(false)
  const [show3dLabels, setShow3dLabels] = useState(false)
  const [showFigureEllipses, setShowFigureEllipses] = useState(true)
  const [showFigureLabels, setShowFigureLabels] = useState(false)
  const [shapeColumn, setShapeColumn] = useState<ShapeColumn>('none')
  const [articleMode, setArticleMode] = useState(true)
  const [legendOrientation, setLegendOrientation] =
    useState<LegendOrientation>('h')
  const [legendPosition, setLegendPosition] =
    useState<LegendPosition>('top-left')
  const [figureKind, setFigureKind] = useState<FigureKind>('score2d')
  const [pcX, setPcX] = useState<ComponentKey>('pc1')
  const [pcY, setPcY] = useState<ComponentKey>('pc2')
  const [figureSize, setFigureSize] = useState<FigureSize>('single')
  const [customFigureWidth, setCustomFigureWidth] = useState(760)
  const [customFigureHeight, setCustomFigureHeight] = useState(560)
  const [useCustomFigureSize, setUseCustomFigureSize] = useState(false)
  const [dpiScale, setDpiScale] = useState<DpiScale>(1)
  const [topLoadings, setTopLoadings] = useState(8)
  const [figureTitle, setFigureTitle] = useState(defaultFigureTitles.score2d)
  const [figureSubtitle, setFigureSubtitle] = useState(
    defaultSubtitleForScaling('autoscale'),
  )
  const [figureCaption, setFigureCaption] = useState(defaultFigureCaptions.score2d)
  const [activeControlTab, setActiveControlTab] = useState<ControlTab>('data')
  const [activeResultView, setActiveResultView] = useState<ResultView>('threeD')

  const loadExampleData = () => {
    setQuantText(exampleQuant)
    setGroupText(exampleGroups)
    setQuantSourceName('内置示例矩阵')
    setGroupSourceName('内置示例分组')
    setQuantUploadError('')
    setGroupUploadError('')
    setOrientation('samples-as-columns')
    setShapeColumn('none')
    setShowCentroids(false)
  }

  const clearInputData = () => {
    setQuantText('')
    setGroupText('')
    setQuantSourceName('未载入矩阵')
    setGroupSourceName('未载入分组表')
    setQuantUploadError('')
    setGroupUploadError('')
  }

  const groupParse = useMemo<
    { table: GroupTable | null; error: string | null }
  >(() => {
    if (!groupText.trim()) return { table: null, error: null }

    try {
      return { table: parseGroupTable(groupText), error: null }
    } catch (error) {
      return {
        table: null,
        error:
          error instanceof Error
            ? error.message
            : 'Group table parsing failed; samples will be treated as ungrouped.',
      }
    }
  }, [groupText])
  const groupTable = groupParse.table

  const activeSampleColumn = groupTable
    ? groupTable.headers.includes(sampleColumn)
      ? sampleColumn
      : pickDefaultColumn(groupTable.headers, 'sample')
    : sampleColumn
  const activeGroupColumn = groupTable
    ? groupTable.headers.includes(groupColumn)
      ? groupColumn
      : pickDefaultColumn(groupTable.headers, 'group')
    : groupColumn
  const activeShapeColumn =
    groupTable && shapeColumn !== 'none' && groupTable.headers.includes(shapeColumn)
      ? shapeColumn
      : 'none'
  const sampleMetadata = useMemo(
    () => groupRowsBySample(groupTable, activeSampleColumn),
    [activeSampleColumn, groupTable],
  )

  const analysis = useMemo<
    | { result: PcaResult; error: null }
    | { result: null; error: string }
    | { result: null; error: null }
  >(() => {
    if (!quantText.trim()) return { result: null, error: null }

    try {
      const quant = parseQuantTable(quantText, orientation)
      const groups = buildGroupMap(groupTable, activeSampleColumn, activeGroupColumn)
      return {
        result: runPca(quant, groups, { logTransform, scalingMethod }),
        error: null,
      }
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : 'PCA 计算失败。',
      }
    }
  }, [activeGroupColumn, activeSampleColumn, groupTable, logTransform, orientation, quantText, scalingMethod])

  useEffect(() => {
    if (!chartRef.current || !analysis.result) return
    const element = chartRef.current
    let cancelled = false
    const style = presetStyle[plotPreset]

    const groups = [...new Set(analysis.result.points.map((point) => point.group))]
    const shapeValues =
      activeShapeColumn === 'none'
        ? []
        : [
            ...new Set(
              analysis.result.points.map((point) =>
                String(
                  sampleMetadata.get(point.sample)?.[activeShapeColumn] ??
                    'No value',
                ),
              ),
            ),
          ]
    const shapeByValue = new Map(
      shapeValues.map((value, index) => [
        value,
        pointShapes[index % pointShapes.length],
      ]),
    )
    const traces: unknown[] = []
    const xRange = paddedRange(analysis.result.points.map((point) => point.pc1))
    const yRange = paddedRange(analysis.result.points.map((point) => point.pc2))
    const zRange = paddedRange(analysis.result.points.map((point) => point.pc3))

    if (showEllipsoids) {
      groups.forEach((group, index) => {
        const points = analysis.result!.points.filter(
          (point) => point.group === group,
        )
        const ellipsoid = buildEllipsoidSurface(points)
        if (!ellipsoid) return

        traces.push({
          type: 'surface',
          name: `${group} 95% score ellipsoid`,
          x: ellipsoid.x,
          y: ellipsoid.y,
          z: ellipsoid.z,
          opacity: 0.16,
          colorscale: [
            [0, colors[index % colors.length]],
            [1, colors[index % colors.length]],
          ],
          hoverinfo: 'skip',
          showscale: false,
          showlegend: false,
        })
      })
    }

    const gridLineColor = articleMode ? '#d1dbe8' : style.gridColor
    const axisLineColor = articleMode ? '#1f2937' : style.axisColor
    if (!articleMode) {
      traces.push(cubeFrameTrace(xRange, yRange, zRange, '#64748b', 2.2))
    }

    groups.forEach((group, index) => {
      const points = analysis.result!.points.filter((point) => point.group === group)
      const groupColor = colors[index % colors.length]
      const markerSymbols = points.map((point) => {
        if (activeShapeColumn === 'none') return 'circle'
        const value = String(
          sampleMetadata.get(point.sample)?.[activeShapeColumn] ?? 'No value',
        )
        return shapeByValue.get(value) ?? 'circle'
      })

      traces.push({
        type: 'scatter3d',
        mode: show3dLabels ? 'markers+text' : 'markers',
        name: group,
        x: points.map((point) => point.pc1),
        y: points.map((point) => point.pc2),
        z: points.map((point) => point.pc3),
        text: points.map((point) => point.sample),
        textposition: 'top center',
        customdata: points.map((point) => [
          activeShapeColumn === 'none'
            ? ''
            : String(sampleMetadata.get(point.sample)?.[activeShapeColumn] ?? 'No value'),
        ]),
        hovertemplate:
          '<b>%{text}</b><br>' +
          `${group}<br>` +
          (activeShapeColumn === 'none'
            ? ''
            : `${activeShapeColumn}: %{customdata[0]}<br>`) +
          'PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}<extra></extra>',
        marker: {
          size: style.markerSize,
          color: groupColor,
          opacity: style.markerOpacity,
          symbol: markerSymbols,
          line: { color: '#ffffff', width: 0.8 },
        },
      })

      if (showCentroids) {
        traces.push({
          type: 'scatter3d',
          mode: 'markers',
          name: `${group} centroid`,
          x: [mean(points.map((point) => point.pc1))],
          y: [mean(points.map((point) => point.pc2))],
          z: [mean(points.map((point) => point.pc3))],
          hovertemplate:
            `<b>${group} centroid</b><br>` +
            'PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}<extra></extra>',
          marker: {
            size: articleMode ? style.markerSize + 4 : style.markerSize + 3,
            color: groupColor,
            symbol: 'diamond',
            line: { color: '#0f172a', width: 2 },
          },
          showlegend: false,
        })
      }
    })

    const sceneAxisStyle = {
      backgroundcolor: 'rgba(248,250,252,0.65)',
      gridcolor: gridLineColor,
      gridwidth: articleMode ? 1.4 : 1,
      zeroline: false,
      showline: true,
      linecolor: axisLineColor,
      linewidth: articleMode ? 2.4 : 2.2,
      tickfont: { size: articleMode ? 13 : 11, color: '#111827' },
    }
    const axisTitleFont = { size: articleMode ? 16 : 13, color: '#111827' }

    const layout = {
      paper_bgcolor: articleMode ? '#ffffff' : 'rgba(255,255,255,0)',
      plot_bgcolor: articleMode ? '#ffffff' : 'rgba(255,255,255,0)',
      font: {
        family: 'Arial, Helvetica, sans-serif',
        size: articleMode ? 13 : 12,
        color: '#111827',
      },
      margin: articleMode
        ? { l: 42, r: 32, t: 34, b: 56 }
        : { l: 14, r: 12, t: 18, b: 50 },
      legend: legendLayout(legendPosition, legendOrientation, articleMode),
      scene: {
        domain: articleMode
          ? { x: [0, 1], y: [0, 1] }
          : { x: [0.02, 0.98], y: [0.04, 0.98] },
        xaxis: {
          title: {
            text: `PC1 (${formatPercent(analysis.result.explained[0])})`,
            font: axisTitleFont,
          },
          range: xRange,
          ...sceneAxisStyle,
        },
        yaxis: {
          title: {
            text: `PC2 (${formatPercent(analysis.result.explained[1])})`,
            font: axisTitleFont,
          },
          range: yRange,
          ...sceneAxisStyle,
        },
        zaxis: {
          title: {
            text: `PC3 (${formatPercent(analysis.result.explained[2])})`,
            font: axisTitleFont,
          },
          range: zRange,
          ...sceneAxisStyle,
        },
        camera: mainCamera,
      },
    }
    plotExportRef.current = { traces, layout }

    void getPlotly().then((Plotly) => {
      if (cancelled) return
      void Plotly.react(element, traces, layout, {
        responsive: true,
        displaylogo: false,
        displayModeBar: !articleMode,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      })
    })

    return () => {
      cancelled = true
      void getPlotly().then((Plotly) => Plotly.purge(element))
    }
  }, [
    activeShapeColumn,
    analysis.result,
    articleMode,
    legendOrientation,
    legendPosition,
    plotPreset,
    sampleMetadata,
    showCentroids,
    showEllipsoids,
    show3dLabels,
  ])

  const result = analysis.result
  const quantDropState: 'ready' | 'empty' | 'error' = quantUploadError
    ? 'error'
    : !quantText.trim()
    ? 'empty'
    : analysis.error
      ? 'error'
      : 'ready'
  const quantMeta = quantUploadError
    ? '文件读取失败，请重新选择文件。'
    : !quantText.trim()
    ? '请上传定量矩阵，或点击顶部“载入示例”。'
    : result
      ? `${result.sampleCount} 个样本 × ${result.featureCount} 个保留特征`
      : analysis.error
        ? '定量矩阵解析失败，请检查表头、方向和数值列。'
        : '正在等待解析结果。'
  const quantDetail =
    quantUploadError || analysis.error
      ? quantUploadError || analysis.error || undefined
      : result && (result.skippedFeatures > 0 || result.zeroVarianceFeatures > 0)
      ? [
          result.skippedFeatures > 0
            ? `跳过 ${result.skippedFeatures} 个含非数值单元的特征`
            : '',
          result.zeroVarianceFeatures > 0
            ? `移除 ${result.zeroVarianceFeatures} 个零方差特征`
            : '',
        ]
          .filter(Boolean)
          .join('；')
      : undefined
  const groupDropState: 'ready' | 'empty' | 'error' = groupUploadError
    ? 'error'
    : !groupText.trim()
    ? 'empty'
    : groupParse.error
      ? 'error'
      : 'ready'
  const groupMeta = groupUploadError
    ? '文件读取失败，请重新选择文件。'
    : !groupText.trim()
    ? '可不上传；缺少分组表时样本会作为未分组处理。'
    : groupTable
      ? `${groupTable.rows.length} 行 × ${groupTable.headers.length} 列`
      : '分组表解析失败，请检查表头和列数。'
  const groupDetail = groupUploadError || groupParse.error
    ? groupUploadError || groupParse.error || undefined
    : groupTable
    ? `样本列：${activeSampleColumn}；分组列：${activeGroupColumn}`
    : undefined
  const groupSampleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    result?.points.forEach((point) => {
      counts.set(point.group, (counts.get(point.group) ?? 0) + 1)
    })
    return counts
  }, [result])
  const groupsWithout3dEllipsoid = [...groupSampleCounts.entries()]
    .filter(([, count]) => count < minSamplesFor3dEllipsoid)
    .map(([group, count]) => `${group} (${count})`)
  const groupsWithout2dEllipse = [...groupSampleCounts.entries()]
    .filter(([, count]) => count < minSamplesFor2dEllipse)
    .map(([group, count]) => `${group} (${count})`)
  const selectedSize = useCustomFigureSize
    ? { label: 'Custom', width: customFigureWidth, height: customFigureHeight }
    : figureSizes[figureSize]
  const figureOptions: FigureOptions = {
    width: selectedSize.width * dpiScale,
    height: selectedSize.height * dpiScale,
    pcX,
    pcY,
    title: figureTitle,
    subtitle: figureSubtitle,
    caption: figureCaption,
    showEllipses: showFigureEllipses,
    showCentroids,
    showLabels: showFigureLabels,
    topLoadings,
    colors,
  }
  const currentFigureSvg = result
    ? {
        score2d: renderScore2dSvg(result, figureOptions),
        scree: renderScreeSvg(result, figureOptions),
        loadings: renderLoadingsSvg(result, figureOptions),
        biplot: renderBiplotSvg(result, figureOptions),
      }[figureKind]
    : ''
  const methodsTexts = result
    ? generateMethodsTexts({
        result,
        orientation,
        sampleColumn: activeSampleColumn,
        groupColumn: activeGroupColumn,
        shapeColumn: activeShapeColumn,
        showEllipsoids,
        showFigureEllipses,
        showCentroids,
        show3dLabels,
        showFigureLabels,
      })
    : { zh: '', en: '' }

  const selectControlTab = (tab: ControlTab) => {
    setActiveControlTab(tab)
    if (tab === 'visual') setActiveResultView('threeD')
    if (tab === 'export') setActiveResultView('figure')
  }

  const showFigurePreview = () => {
    setActiveResultView('figure')
  }

  const resetMainView = async () => {
    if (!chartRef.current) return
    const Plotly = await getPlotly()
    const interactivePlotly = Plotly as typeof Plotly & {
      relayout: (
        element: HTMLElement,
        update: Record<string, unknown>,
      ) => Promise<unknown>
    }
    await interactivePlotly.relayout(chartRef.current, { 'scene.camera': mainCamera })
  }

  const renderThreeDExportImage = async (
    format: 'png' | 'svg',
    width: number,
    height: number,
  ) => {
    if (!chartRef.current || !plotExportRef.current) return ''

    const currentScene = (chartRef.current as HTMLDivElement & {
      _fullLayout?: { scene?: { camera?: unknown } }
    })._fullLayout?.scene
    const currentCamera = currentScene?.camera
    const exportElement = document.createElement('div')
    const state = plotExportRef.current
    const exportLayout = {
      ...state.layout,
      width,
      height,
      autosize: false,
      scene: {
        ...((state.layout.scene as Record<string, unknown>) ?? {}),
        ...(currentCamera ? { camera: currentCamera } : {}),
      },
    }

    exportElement.style.position = 'fixed'
    exportElement.style.left = '-10000px'
    exportElement.style.top = '0'
    exportElement.style.width = `${width}px`
    exportElement.style.height = `${height}px`
    document.body.appendChild(exportElement)

    const Plotly = await getPlotly()
    const exportPlotly = Plotly as typeof Plotly & {
      newPlot: (
        element: HTMLElement,
        data: unknown[],
        layout?: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<unknown>
    }
    await exportPlotly.newPlot(exportElement, state.traces, exportLayout, {
      staticPlot: true,
      displayModeBar: false,
      displaylogo: false,
    })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const image = await Plotly.toImage(exportElement, {
        format,
        width,
        height,
        scale: 1,
      })
    Plotly.purge(exportElement)
    exportElement.remove()

    return image
  }

  const exportThreeDPng = async () => {
    const image = await renderThreeDExportImage(
      'png',
      selectedSize.width * dpiScale,
      selectedSize.height * dpiScale,
    )
    if (!image) return
    downloadDataUrl('pca-figure-studio-plot.png', image)
  }

  const exportThreeDSvg = async () => {
    const image = await renderThreeDExportImage(
      'svg',
      selectedSize.width * dpiScale,
      selectedSize.height * dpiScale,
    )
    if (!image) return
    downloadDataUrl('pca-figure-studio-plot.svg', image)
  }

  return (
    <main className="app-shell">
      <section className="intro">
        <div>
          <div className="brand">
            <Rotate3D size={24} aria-hidden="true" />
            <span>PCA Figure Studio</span>
          </div>
          <h1>交互式 3D PCA 分析</h1>
          <p>
            上传定量矩阵和样本分组表，在浏览器内完成 PCA，生成可旋转、缩放、悬停查看样本信息的 3D 图。
          </p>
        </div>
        <div className="intro-actions">
          <button
            type="button"
            className="button primary"
            onClick={loadExampleData}
          >
            <Play size={16} aria-hidden="true" />
            载入示例
          </button>
          <a className="button ghost" href="./sample-expression.csv" download>
            <FileSpreadsheet size={16} aria-hidden="true" />
            示例矩阵
          </a>
          <a className="button ghost" href="./sample-groups.csv" download>
            <FileSpreadsheet size={16} aria-hidden="true" />
            示例分组
          </a>
        </div>
      </section>

      <section className="workspace">
        <aside className="control-panel">
          <div className="control-tabs" role="tablist" aria-label="PCA Figure Studio 控制区">
            {controlTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={activeControlTab === tab.value}
                className={activeControlTab === tab.value ? 'is-active' : ''}
                onClick={() => selectControlTab(tab.value)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="control-section" hidden={activeControlTab !== 'data'}>
          <PanelTitle icon={<Download size={18} />} title="输入数据" />
          <FileDrop
            label="定量矩阵"
            description="CSV / TSV / TXT；第一列为特征或样本 ID"
            source={quantSourceName}
            meta={quantMeta}
            detail={quantDetail}
            state={quantDropState}
            onRead={(text, filename) => {
              setQuantText(text)
              setQuantSourceName(filename)
              setQuantUploadError('')
            }}
            onError={(message, filename) => {
              setQuantText('')
              setQuantSourceName(filename)
              setQuantUploadError(message)
            }}
          />
          <FileDrop
            label="样本分组"
            description="CSV / TSV / TXT；至少包含样本列和分组列"
            source={groupSourceName}
            meta={groupMeta}
            detail={groupDetail}
            state={groupDropState}
            onRead={(text, filename) => {
              setGroupText(text)
              setGroupSourceName(filename)
              setGroupUploadError('')
            }}
            onError={(message, filename) => {
              setGroupText('')
              setGroupSourceName(filename)
              setGroupUploadError(message)
            }}
          />
          <button
            type="button"
            className="button subtle full data-clear-button"
            disabled={
              !quantText.trim() &&
              !groupText.trim() &&
              !quantUploadError &&
              !groupUploadError
            }
            onClick={clearInputData}
          >
            <RefreshCw size={16} aria-hidden="true" />
            清空已上传数据
          </button>

          <div className="field">
            <label htmlFor="orientation">矩阵方向</label>
            <select
              id="orientation"
              value={orientation}
              onChange={(event) => setOrientation(event.target.value as Orientation)}
            >
              <option value="samples-as-columns">样本在列，特征在行</option>
              <option value="samples-as-rows">样本在行，特征在列</option>
            </select>
          </div>

          {groupTable ? (
            <div className="two-fields">
              <div className="field">
                <label htmlFor="sample-column">样本列</label>
                <select
                  id="sample-column"
                  value={activeSampleColumn}
                  onChange={(event) => setSampleColumn(event.target.value)}
                >
                  {groupTable.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="group-column">分组列</label>
                <select
                  id="group-column"
                  value={activeGroupColumn}
                  onChange={(event) => setGroupColumn(event.target.value)}
                >
                  {groupTable.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          </div>

          <div className="control-section" hidden={activeControlTab !== 'analysis'}>
          <PanelTitle icon={<Settings2 size={18} />} title="分析参数" />
          <div className="switch-row">
            <span>
              <strong>log2(x + 1)</strong>
              <small>适合非负计数或丰度数据</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={logTransform}
                onChange={(event) => setLogTransform(event.target.checked)}
              />
              <span />
            </label>
          </div>
          <div className="field">
            <label htmlFor="scaling-method">特征缩放 / 预处理</label>
            <select
              id="scaling-method"
              value={scalingMethod}
              onChange={(event) => {
                const nextMethod = event.target.value as ScalingMethod
                setFigureSubtitle((current) => {
                  const defaultSubtitles: string[] = scalingMethodOptions.map(
                    (option) => defaultSubtitleForScaling(option.value),
                  )
                  return defaultSubtitles.includes(current)
                    ? defaultSubtitleForScaling(nextMethod)
                    : current
                })
                setScalingMethod(nextMethod)
              }}
            >
              {scalingMethodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="field-hint">
              {
                scalingMethodOptions.find(
                  (option) => option.value === scalingMethod,
                )?.description
              }
            </small>
          </div>
          <div className="parameter-notes">
            <p>
              <strong>log2(x + 1)</strong>
              ：常用于 RNA-seq counts、蛋白/代谢物丰度等右偏且非负的数据；如果输入已经是 log
              转换后的矩阵，通常不要重复开启。
            </p>
            <p>
              <strong>特征缩放</strong>
              ：这些选项不是不同的 PCA 算法，而是 SVD PCA 前的特征预处理策略。Autoscaling
              会让每个特征方差相同；Mean-centering 更保留原始方差权重；Pareto 介于两者之间；Range scaling
              对极端值更敏感。
            </p>
          </div>
          </div>

          <div className="control-section" hidden={activeControlTab !== 'visual'}>
          {groupTable ? (
            <div className="field">
              <label htmlFor="shape-column">点形状分组</label>
              <select
                id="shape-column"
                value={activeShapeColumn}
                onChange={(event) => setShapeColumn(event.target.value)}
              >
                <option value="none">不按形状区分</option>
                {groupTable.headers
                  .filter(
                    (header) =>
                      header !== activeSampleColumn && header !== activeGroupColumn,
                  )
                  .map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
              </select>
              <small className="field-hint">
                可选：用不同点形状显示批次、时间点等第二层元数据；没有对应列时会自动忽略。
              </small>
            </div>
          ) : null}

          <PanelTitle icon={<Shapes size={18} />} title="3D 图例" />
          <div className="two-fields">
            <div className="field">
              <label htmlFor="legend-position">图例位置</label>
              <select
                id="legend-position"
                value={legendPosition}
                onChange={(event) =>
                  setLegendPosition(event.target.value as LegendPosition)
                }
              >
                {legendPositionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="legend-orientation">图例排列</label>
              <select
                id="legend-orientation"
                value={legendOrientation}
                onChange={(event) =>
                  setLegendOrientation(event.target.value as LegendOrientation)
                }
              >
                {legendOrientationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <PanelTitle icon={<Tags size={18} />} title="图层" />
          <div className="switch-row">
            <span>
              <strong>3D 近似 95% 得分椭球</strong>
              <small>只控制 3D PCA 图；表示组内样本分布范围，不是均值置信区间</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={showEllipsoids}
                onChange={(event) => setShowEllipsoids(event.target.checked)}
              />
              <span />
            </label>
          </div>
          {showEllipsoids && groupsWithout3dEllipsoid.length > 0 ? (
            <p className="inline-warning">
              3D 协方差椭球至少需要每组 {minSamplesFor3dEllipsoid}{' '}
              个样本；以下分组当前不会绘制 3D 椭球：{groupsWithout3dEllipsoid.join('、')}。
            </p>
          ) : null}
          <div className="switch-row">
            <span>
              <strong>分组质心</strong>
              <small>用菱形标记每组中心</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={showCentroids}
                onChange={(event) => setShowCentroids(event.target.checked)}
              />
              <span />
            </label>
          </div>
          <div className="switch-row">
            <span>
              <strong>3D 样本标签</strong>
              <small>只控制 3D PCA 图中的样本名</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={show3dLabels}
                onChange={(event) => setShow3dLabels(event.target.checked)}
              />
              <span />
            </label>
          </div>
          </div>

          <div className="control-section" hidden={activeControlTab !== 'export'}>
          <PanelTitle icon={<FileText size={18} />} title="发表图设置" />
          <div className="switch-row">
            <span>
              <strong>Article Mode</strong>
              <small>固定白底、隐藏 3D 工具栏、适合导出</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={articleMode}
                onChange={(event) => setArticleMode(event.target.checked)}
              />
              <span />
            </label>
          </div>

          <div className="field">
            <label htmlFor="figure-kind">静态图类型</label>
            <select
              id="figure-kind"
              value={figureKind}
              onChange={(event) => {
                showFigurePreview()
                const nextKind = event.target.value as FigureKind
                setFigureTitle((current) =>
                  Object.values(defaultFigureTitles).includes(current)
                    ? defaultFigureTitles[nextKind]
                    : current,
                )
                setFigureCaption((current) =>
                  Object.values(defaultFigureCaptions).includes(current)
                    ? defaultFigureCaptions[nextKind]
                    : current,
                )
                setFigureKind(nextKind)
              }}
            >
              {figureKindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="field-hint">
              静态图会使用当前 log 转换、特征缩放和分组设置重新生成。
            </small>
          </div>

          <div className="switch-row">
            <span>
              <strong>2D 近似 95% 得分椭圆</strong>
              <small>只控制 2D PCA score / biplot；表示组内样本分布范围，不是均值置信区间</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={showFigureEllipses}
                onChange={(event) => {
                  showFigurePreview()
                  setShowFigureEllipses(event.target.checked)
                }}
              />
              <span />
            </label>
          </div>
          {showFigureEllipses && groupsWithout2dEllipse.length > 0 ? (
            <p className="inline-warning">
              2D 得分椭圆至少需要每组 {minSamplesFor2dEllipse}{' '}
              个样本；以下分组当前不会绘制 2D 椭圆：{groupsWithout2dEllipse.join('、')}。
            </p>
          ) : null}

          <div className="switch-row">
            <span>
              <strong>2D 静态图样本标签</strong>
              <small>只控制 2D PCA score / biplot 中的样本名</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={showFigureLabels}
                onChange={(event) => {
                  showFigurePreview()
                  setShowFigureLabels(event.target.checked)
                }}
              />
              <span />
            </label>
          </div>

          <div className="two-fields">
            <div className="field">
              <label htmlFor="pc-x">横轴</label>
              <select
                id="pc-x"
                value={pcX}
                onChange={(event) => {
                  showFigurePreview()
                  setPcX(event.target.value as ComponentKey)
                }}
              >
                {componentOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.value === pcY}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pc-y">纵轴</label>
              <select
                id="pc-y"
                value={pcY}
                onChange={(event) => {
                  showFigurePreview()
                  setPcY(event.target.value as ComponentKey)
                }}
              >
                {componentOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.value === pcX}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="two-fields">
            <div className="field">
              <label htmlFor="figure-size">尺寸</label>
              <select
                id="figure-size"
                value={figureSize}
                onChange={(event) => {
                  showFigurePreview()
                  const nextSize = event.target.value as FigureSize
                  setFigureSize(nextSize)
                  setUseCustomFigureSize(false)
                  setCustomFigureWidth(figureSizes[nextSize].width)
                  setCustomFigureHeight(figureSizes[nextSize].height)
                }}
              >
                {Object.entries(figureSizes).map(([value, size]) => (
                  <option key={value} value={value}>
                    {size.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dpi-scale">分辨率</label>
              <select
                id="dpi-scale"
                value={dpiScale}
                onChange={(event) => {
                  showFigurePreview()
                  setDpiScale(Number(event.target.value) as DpiScale)
                }}
              >
                <option value={1}>300 DPI</option>
                <option value={2}>600 DPI</option>
              </select>
            </div>
          </div>

          <div className="switch-row">
            <span>
              <strong>手动设置图片尺寸</strong>
              <small>用于按期刊要求导出指定像素宽高</small>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={useCustomFigureSize}
                onChange={(event) => {
                  showFigurePreview()
                  setUseCustomFigureSize(event.target.checked)
                }}
              />
              <span />
            </label>
          </div>
          <div className="two-fields">
            <div className="field">
              <label htmlFor="custom-width">宽度 px</label>
              <input
                id="custom-width"
                type="number"
                min="520"
                max="3200"
                step="20"
                value={customFigureWidth}
                disabled={!useCustomFigureSize}
                onChange={(event) =>
                  {
                    showFigurePreview()
                    setCustomFigureWidth(
                      Math.max(520, Math.min(3200, Number(event.target.value) || 760)),
                    )
                  }
                }
              />
            </div>
            <div className="field">
              <label htmlFor="custom-height">高度 px</label>
              <input
                id="custom-height"
                type="number"
                min="420"
                max="2400"
                step="20"
                value={customFigureHeight}
                disabled={!useCustomFigureSize}
                onChange={(event) =>
                  {
                    showFigurePreview()
                    setCustomFigureHeight(
                      Math.max(420, Math.min(2400, Number(event.target.value) || 560)),
                    )
                  }
                }
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="top-loadings">Top loading 数量</label>
            <input
              id="top-loadings"
              type="number"
              min="3"
              max="30"
              value={topLoadings}
              onChange={(event) => {
                showFigurePreview()
                setTopLoadings(
                  Math.max(3, Math.min(30, Number(event.target.value) || 8)),
                )
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="figure-title">图标题</label>
            <input
              id="figure-title"
              value={figureTitle}
              onChange={(event) => {
                showFigurePreview()
                setFigureTitle(event.target.value)
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="figure-subtitle">副标题</label>
            <input
              id="figure-subtitle"
              value={figureSubtitle}
              onChange={(event) => {
                showFigurePreview()
                setFigureSubtitle(event.target.value)
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="figure-caption">图注</label>
            <input
              id="figure-caption"
              value={figureCaption}
              onChange={(event) => {
                showFigurePreview()
                setFigureCaption(event.target.value)
              }}
            />
          </div>
          </div>
        </aside>

        <section className="result-panel">
          <div className="result-header">
            <PanelTitle icon={<BarChart3 size={18} />} title="输出预览" />
            <div className="result-actions">
              {activeResultView === 'threeD' ? (
                <>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() => void resetMainView()}
                  >
                    <Rotate3D size={16} aria-hidden="true" />
                    主视图
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() =>
                      result &&
                      downloadText('pca-figure-studio-scores.csv', scoresToCsv(result.points))
                    }
                  >
                    <Download size={16} aria-hidden="true" />
                    PCA 坐标
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() => void exportThreeDPng()}
                  >
                    <Download size={16} aria-hidden="true" />
                    PNG
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() => void exportThreeDSvg()}
                  >
                    <Download size={16} aria-hidden="true" />
                    SVG
                  </button>
                </>
              ) : null}
              {activeResultView === 'figure' ? (
                <>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() =>
                      downloadSvg(`pca-figure-studio-${figureKind}.svg`, currentFigureSvg)
                    }
                  >
                    <Download size={16} aria-hidden="true" />
                    SVG
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() =>
                      void downloadSvgAsPng(
                        `pca-figure-studio-${figureKind}.png`,
                        currentFigureSvg,
                      )
                    }
                  >
                    <Download size={16} aria-hidden="true" />
                    PNG
                  </button>
                </>
              ) : null}
              {activeResultView === 'methods' ? (
                <>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() => void navigator.clipboard.writeText(methodsTexts.zh)}
                  >
                    <FileText size={16} aria-hidden="true" />
                    复制中文
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() => void navigator.clipboard.writeText(methodsTexts.en)}
                  >
                    <FileText size={16} aria-hidden="true" />
                    Copy EN
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={!result}
                    onClick={() =>
                      downloadText(
                        'pca-figure-studio-methods-bilingual.txt',
                        `中文方法学说明\n\n${methodsTexts.zh}\n\nEnglish methods\n\n${methodsTexts.en}`,
                      )
                    }
                  >
                    <Download size={16} aria-hidden="true" />
                    TXT
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="output-tabs" role="tablist" aria-label="输出视图">
            {resultViews.map((view) => (
              <button
                key={view.value}
                type="button"
                role="tab"
                aria-selected={activeResultView === view.value}
                className={activeResultView === view.value ? 'is-active' : ''}
                onClick={() => setActiveResultView(view.value)}
              >
                {view.icon}
                <span>{view.label}</span>
              </button>
            ))}
          </div>

          {analysis.error || groupParse.error ? (
            <div className="error">{analysis.error ?? groupParse.error}</div>
          ) : null}

          {result ? (
            <>
              <div className="stats-grid">
                <Stat label="样本" value={result.sampleCount} />
                <Stat label="保留特征" value={result.featureCount} />
                <Stat label="分组" value={result.groupCount} />
                <Stat label="PC1+PC2+PC3" value={formatPercent(result.cumulative[2])} />
              </div>
              <section
                className="output-view"
                hidden={activeResultView !== 'threeD'}
              >
              <div
                className="chart-frame"
                style={{
                  background: articleMode
                    ? '#ffffff'
                    : presetStyle[plotPreset].chartBackground,
                }}
              >
                <div ref={chartRef} className="chart" />
              </div>
              <div className="variance-row">
                {result.explained.map((value, index) => (
                  <div className="variance" key={index}>
                    <span>PC{index + 1}</span>
                    <strong>{formatPercent(value)}</strong>
                    <div>
                      <i style={{ width: `${Math.max(value * 100, 4)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              {result.skippedFeatures > 0 ? (
                <p className="note">
                  已跳过 {result.skippedFeatures} 个含非数值单元的特征，共发现{' '}
                  {result.invalidCells} 个非数值单元。
                </p>
              ) : null}
              {result.zeroVarianceFeatures > 0 ? (
                <p className="note">
                  已移除 {result.zeroVarianceFeatures} 个预处理后零方差的特征。
                </p>
              ) : null}
              {showEllipsoids && groupsWithout3dEllipsoid.length > 0 ? (
                <p className="note warning-note">
                  3D 协方差椭球至少需要每组 {minSamplesFor3dEllipsoid}{' '}
                  个样本；以下分组当前不会绘制 3D 椭球：{groupsWithout3dEllipsoid.join('、')}。
                </p>
              ) : null}
              </section>
              <section
                className="output-view publication-panel"
                hidden={activeResultView !== 'figure'}
              >
                <div className="result-header">
                  <PanelTitle icon={<FileText size={18} />} title="Publication Figure" />
                </div>
                <div className="svg-preview">
                  <div
                    className="svg-stage"
                    dangerouslySetInnerHTML={{ __html: currentFigureSvg }}
                  />
                </div>
              </section>
              <section
                className="output-view publication-panel"
                hidden={activeResultView !== 'methods'}
              >
                <div className="result-header">
                  <PanelTitle icon={<FileText size={18} />} title="方法学说明 / Methods" />
                </div>
                <div className="methods-grid">
                  <article className="methods-box">
                    <h3>中文方法学说明</h3>
                    <p>{methodsTexts.zh}</p>
                  </article>
                  <article className="methods-box">
                    <h3>English methods</h3>
                    <p>{methodsTexts.en}</p>
                  </article>
                </div>
              </section>
            </>
          ) : (
            <div className="empty-state">
              <Rotate3D size={44} aria-hidden="true" />
              <h2>等待数据</h2>
              <p>上传矩阵后会自动计算 PCA；分组表可选，未匹配样本会归入“未分组”。</p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
