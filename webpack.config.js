import path from 'path';
import { fileURLToPath } from 'url';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMPONENTS = {
  Scatter: './src/components/Scatter/index.ts',
  ScatterConfiguration: './src/components/ScatterConfiguration/index.ts',
};

export default (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    entry: isProd ? COMPONENTS : { app: './src/index.tsx' },
    output: {
      path: path.resolve(__dirname, isProd ? 'dist-bundle' : 'dist'),
      filename: isProd ? '[name].bundle.js' : '[name].js',
      globalObject: 'this',
      clean: true,
    },
    externals: isProd
      ? [
          {
            react: 'React',
            'react-dom': 'ReactDOM',
            'react-dom/client': 'ReactDOM',
            'react-dom/server': 'ReactDOMServer',
            'react/jsx-runtime': 'ReactJSXRuntime',
            'react/jsx-dev-runtime': 'ReactJSXRuntime',
            apexcharts: 'ApexCharts',
          },
          // Submodule requests like `highcharts/modules/exporting` don't match the
          // exact-string external above, so webpack tries to actually resolve them —
          // and design-sdk's ESM output omits extensions, which webpack5 rejects
          // ("fully specified" resolution). They're side-effect additions to the same
          // global Highcharts object the host page provides, so externalize the whole
          // `highcharts` namespace rather than just the bare specifier.
          ({ request }, callback) => {
            if (request === 'highcharts' || request.startsWith('highcharts/')) {
              return callback(null, 'Highcharts');
            }
            callback();
          },
        ]
      : [],
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [
        {
          // highcharts ships ESM with extensionless deep imports (e.g.
          // 'highcharts/modules/exporting'); webpack5 requires fully-specified
          // extensions for ESM by default. Relax that so normal Node-style
          // resolution (auto-appending .js) applies to every JS/MJS module.
          test: /\.m?js$/,
          resolve: { fullySpecified: false },
        },
        {
          test: /\.(ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-env',
                ['@babel/preset-react', { runtime: 'automatic' }],
                '@babel/preset-typescript',
              ],
            },
          },
        },
        {
          test: /\.css$/,
          use: [
            isProd ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
          ],
        },
        {
          test: /\.(png|jpg|jpeg|gif|webp|svg)$/i,
          type: 'asset/resource',
          generator: { filename: 'assets/[name][ext]' },
        },
      ],
    },
    plugins: [
      ...(isProd ? [new MiniCssExtractPlugin({ filename: '[name].bundle.css' })] : []),
    ],
    ...(!isProd && {
      devServer: {
        static: path.resolve(__dirname, 'public'),
        port: 3000,
        hot: true,
        open: false,
        historyApiFallback: true,
      },
    }),
  };
};
