# PCA Figure Studio

PCA Figure Studio is a static browser app for publication-oriented PCA figures. Users upload a quantitative matrix and an optional sample grouping table, then rotate, zoom, inspect, and export interactive 3D PCA plots, static 2D figures, and methods text without a backend.

## Features

- CSV / TSV / TXT upload for quantitative matrices.
- Supports both common orientations:
  - samples in columns, features in rows
  - samples in rows, features in columns
- Optional sample grouping table with selectable sample and group columns.
- Literature-inspired presets: Classic Journal, Omics QC, Ellipsoid, and Minimal Nature.
- Optional 95% group ellipsoids, group centroids, sample labels, and metadata-based marker shapes.
- Article Mode for white-background deterministic 3D export.
- Static publication figures: 2D PCA score plot, scree plot, top loadings plot, and biplot.
- SVG/PNG export for static figures.
- Browser-side PCA with optional `log2(x + 1)` transformation and explicit centering/scaling choices.
- Explicit preprocessing choices: mean-centering, autoscaling/unit variance, Pareto scaling, and range scaling.
- Bilingual generated methods text based on the selected transformation, scaling, grouping, and figure layers.
- Interactive 3D Plotly scatter plot with hover labels and grouped colors.
- Export PCA scores as CSV and the current plot as PNG.
- GitHub Pages workflow included.

## Input Format

Quantitative matrix, samples in columns:

```csv
Feature,S01,S02,S03
GeneA,10.2,12.1,9.8
GeneB,4.2,5.5,4.9
GeneC,22.1,20.8,23.4
```

Sample grouping table:

```csv
Sample,Group,Batch
S01,Control,B1
S02,Treatment,B1
S03,Treatment,B2
```

Example files are available in `public/sample-expression.csv` and `public/sample-groups.csv`.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The static output is written to `dist/`.

## Deploy to GitHub Pages

1. Push this project to a GitHub repository.
2. In repository settings, enable Pages and choose GitHub Actions as the source.
3. Push to the `main` or `master` branch.

The included `.github/workflows/deploy.yml` workflow installs dependencies, builds the app, and publishes `dist/`.

The Vite build uses relative asset paths (`base: './'`), so the app works when hosted under a repository subpath such as:

```text
https://your-name.github.io/pca-figure-studio/
```

All PCA computation runs in the visitor's browser. Uploaded tables are not sent to a backend by this static GitHub Pages deployment.
