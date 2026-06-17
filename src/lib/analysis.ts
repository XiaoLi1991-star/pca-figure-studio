import Papa from 'papaparse'
import { PCA } from 'ml-pca'

export type Orientation = 'samples-as-rows' | 'samples-as-columns'

export type QuantTable = {
  sampleNames: string[]
  featureNames: string[]
  matrix: number[][]
  skippedFeatures: number
  invalidCells: number
  minValue: number
  maxValue: number
}

export type GroupTable = {
  headers: string[]
  rows: Record<string, string>[]
}

export type ScalingMethod = 'center' | 'autoscale' | 'pareto' | 'range'

export type AnalysisOptions = {
  logTransform: boolean
  scalingMethod: ScalingMethod
}

export type PcaPoint = {
  sample: string
  group: string
  pc1: number
  pc2: number
  pc3: number
}

export type PcaLoading = {
  feature: string
  pc1: number
  pc2: number
  pc3: number
  contribution: number
}

export type PcaResult = {
  points: PcaPoint[]
  explained: number[]
  allExplained: number[]
  cumulative: number[]
  allCumulative: number[]
  loadings: PcaLoading[]
  sampleCount: number
  featureCount: number
  zeroVarianceFeatures: number
  groupCount: number
  skippedFeatures: number
  invalidCells: number
  options: AnalysisOptions
}

const numeric = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const text = String(value ?? '').trim()
  if (!text) return NaN
  return Number(text.replace(/,/g, ''))
}

const clean = (value: unknown) => String(value ?? '').trim()

const parseRows = (text: string) => {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0].message)
  }

  const rows = parsed.data.filter((row) =>
    Object.values(row).some((value) => clean(value)),
  )
  const headers = parsed.meta.fields?.filter(Boolean) ?? []

  if (headers.length < 2 || rows.length === 0) {
    throw new Error('表格需要表头，并且至少包含一个 ID 列和一个数值列。')
  }

  return { headers, rows }
}

export const parseQuantTable = (
  text: string,
  orientation: Orientation,
): QuantTable => {
  const { headers, rows } = parseRows(text)
  const idColumn = headers[0]
  const valueColumns = headers.slice(1)

  if (valueColumns.length < 3) {
    throw new Error('3D PCA 至少需要 3 个可用数值特征。')
  }

  let invalidCells = 0
  let skippedFeatures = 0
  let sampleNames: string[]
  const featureNames: string[] = []
  let matrix: number[][]

  if (orientation === 'samples-as-rows') {
    const usableRows = rows.filter((row) => clean(row[idColumn]))
    sampleNames = usableRows.map((row) => clean(row[idColumn]))
    matrix = sampleNames.map(() => [])

    for (const column of valueColumns) {
      const values = usableRows.map((row) => numeric(row[column]))

      if (values.some((value) => !Number.isFinite(value))) {
        invalidCells += values.filter((value) => !Number.isFinite(value)).length
        skippedFeatures += 1
        continue
      }

      featureNames.push(column)
      values.forEach((value, sampleIndex) => {
        matrix[sampleIndex].push(value)
      })
    }
  } else {
    sampleNames = valueColumns
    const featureRows: number[][] = []

    for (const row of rows) {
      const featureName = clean(row[idColumn])
      if (!featureName) continue

      const values = sampleNames.map((sample) => numeric(row[sample]))

      if (values.some((value) => !Number.isFinite(value))) {
        invalidCells += values.filter((value) => !Number.isFinite(value)).length
        skippedFeatures += 1
        continue
      }

      featureNames.push(featureName)
      featureRows.push(values)
    }

    matrix = sampleNames.map((_, sampleIndex) =>
      featureRows.map((feature) => feature[sampleIndex]),
    )
  }

  if (sampleNames.length < 4) {
    throw new Error('3D PCA 建议至少 4 个样本，否则第三主成分不稳定或不可用。')
  }

  if (featureNames.length < 3 || matrix.some((row) => row.length < 3)) {
    throw new Error('清理非数值列后，剩余可用特征少于 3 个。')
  }

  const flat = matrix.flat()

  return {
    sampleNames,
    featureNames,
    matrix,
    skippedFeatures,
    invalidCells,
    minValue: Math.min(...flat),
    maxValue: Math.max(...flat),
  }
}

export const parseGroupTable = (text: string): GroupTable => {
  const { headers, rows } = parseRows(text)
  if (headers.length < 2) {
    throw new Error('分组表至少需要样本列和分组列。')
  }

  return { headers, rows }
}

export const pickDefaultColumn = (headers: string[], purpose: 'sample' | 'group') => {
  const sampleNames = /^(sample|sampleid|sample_id|sample name|id)$/i
  const groupNames = /^(group|condition|class|type|treatment|batch)$/i
  const pattern = purpose === 'sample' ? sampleNames : groupNames
  return headers.find((header) => pattern.test(header)) ?? headers[purpose === 'sample' ? 0 : 1]
}

export const buildGroupMap = (
  table: GroupTable | null,
  sampleColumn: string,
  groupColumn: string,
) => {
  const groups = new Map<string, string>()

  if (!table) return groups

  for (const row of table.rows) {
    const sample = clean(row[sampleColumn])
    const group = clean(row[groupColumn])
    if (sample && group) groups.set(sample, group)
  }

  return groups
}

export const runPca = (
  table: QuantTable,
  groups: Map<string, string>,
  options: AnalysisOptions,
): PcaResult => {
  const componentCapacity = Math.min(table.matrix.length - 1, table.matrix[0].length)

  if (componentCapacity < 3) {
    throw new Error('当前矩阵无法产生 3 个主成分，请增加样本数或特征数。')
  }

  const transformed = table.matrix.map((row) =>
    row.map((value) => {
      if (!options.logTransform) return value
      if (value < 0) {
        throw new Error('log2(x + 1) 转换要求所有输入值不小于 0。')
      }
      return Math.log2(value + 1)
    }),
  )
  const featureCount = transformed[0].length
  const means = Array.from({ length: featureCount }, (_, featureIndex) => {
    const values = transformed.map((row) => row[featureIndex])
    return values.reduce((total, value) => total + value, 0) / values.length
  })
  const stdevs = Array.from({ length: featureCount }, (_, featureIndex) => {
    const values = transformed.map((row) => row[featureIndex])
    const variance =
      values.reduce(
        (total, value) => total + (value - means[featureIndex]) ** 2,
        0,
      ) / Math.max(values.length - 1, 1)
    return Math.sqrt(variance)
  })
  const ranges = Array.from({ length: featureCount }, (_, featureIndex) => {
    const values = transformed.map((row) => row[featureIndex])
    return Math.max(...values) - Math.min(...values)
  })
  const retainedFeatureIndexes = stdevs
    .map((stdev, index) => ({ stdev, index }))
    .filter(({ stdev }) => stdev > 0)
    .map(({ index }) => index)
  const zeroVarianceFeatures = featureCount - retainedFeatureIndexes.length

  if (retainedFeatureIndexes.length < 3) {
    throw new Error('去除零方差特征后，剩余可用特征少于 3 个。')
  }

  const scalingDenominator = (featureIndex: number) => {
    if (options.scalingMethod === 'autoscale') return stdevs[featureIndex]
    if (options.scalingMethod === 'pareto') return Math.sqrt(stdevs[featureIndex])
    if (options.scalingMethod === 'range') return ranges[featureIndex]
    return 1
  }
  const matrix = transformed.map((row) =>
    retainedFeatureIndexes.map((featureIndex) => {
      const centered = row[featureIndex] - means[featureIndex]
      return centered / scalingDenominator(featureIndex)
    }),
  )
  const retainedFeatureNames = retainedFeatureIndexes.map(
    (index) => table.featureNames[index],
  )

  const pca = new PCA(matrix, {
    center: false,
    scale: false,
  })
  const scores = pca.predict(matrix, { nComponents: 3 }).to2DArray()
  const allExplained = pca.getExplainedVariance()
  const allCumulative = pca.getCumulativeVariance()
  const explained = allExplained.slice(0, 3)
  const cumulative = allCumulative.slice(0, 3)
  const loadingMatrix = pca.getLoadings().to2DArray()
  const loadings = retainedFeatureNames
    .map((feature, index) => {
      const pc1 = loadingMatrix[index]?.[0] ?? 0
      const pc2 = loadingMatrix[index]?.[1] ?? 0
      const pc3 = loadingMatrix[index]?.[2] ?? 0

      return {
        feature,
        pc1,
        pc2,
        pc3,
        contribution: pc1 ** 2 + pc2 ** 2 + pc3 ** 2,
      }
    })
    .sort((a, b) => b.contribution - a.contribution)
  const points = scores.map((score, index) => {
    const sample = table.sampleNames[index]
    return {
      sample,
      group: groups.get(sample) ?? '未分组',
      pc1: score[0],
      pc2: score[1],
      pc3: score[2],
    }
  })

  return {
    points,
    explained,
    allExplained,
    cumulative,
    allCumulative,
    loadings,
    sampleCount: table.sampleNames.length,
    featureCount: retainedFeatureNames.length,
    zeroVarianceFeatures,
    groupCount: new Set(points.map((point) => point.group)).size,
    skippedFeatures: table.skippedFeatures,
    invalidCells: table.invalidCells,
    options,
  }
}

export const scoresToCsv = (points: PcaPoint[]) => {
  const header = 'Sample,Group,PC1,PC2,PC3'
  const rows = points.map((point) =>
    [
      point.sample,
      point.group,
      point.pc1.toFixed(6),
      point.pc2.toFixed(6),
      point.pc3.toFixed(6),
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(','),
  )

  return [header, ...rows].join('\n')
}
