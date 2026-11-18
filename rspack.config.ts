import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Compiler, type Configuration } from '@rspack/core'
import sharp from 'sharp'

const dev = process.env.NODE_ENV !== 'production'
const targets = ['chrome >= 105', 'edge >= 105', 'safari >= 16', 'firefox >= 110']
const root = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets, minify: !dev },
}

/**
 * 从 assets 里的 favicon.svg 自动生成 180×180 的 apple-touch-icon.png：
 * 白底、PNG 格式，构建时输出到 static/icons/，不在源码里存 PNG。
 */
class AppleTouchIconPlugin {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap('AppleTouchIconPlugin', (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: 'AppleTouchIconPlugin',
          stage: rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        async () => {
          const svg = readFileSync(path.resolve(root, 'src/assets/icons/favicon.svg'))
          // 180×180 画布内缩到 144×144，四周各留 18px 白边
          const inner = 144
          const padding = (180 - inner) / 2
          const logo = await sharp(svg, { density: 600 })
            .resize(inner, inner, { fit: 'contain', background: '#ffffff' })
            .flatten({ background: '#ffffff' })
            .png()
            .toBuffer()
          const png = await sharp({
            create: { width: 180, height: 180, channels: 3, background: '#ffffff' },
          })
            .composite([{ input: logo, top: padding, left: padding }])
            .png()
            .toBuffer()
          compilation.emitAsset('static/icons/icon-180.png', new rspack.sources.RawSource(png))
        }
      )
    })
  }
}

type ConfigOptions = {
  /** 公开 API 的地址，注入为 __API_ORIGIN__ */
  apiOrigin?: string
  /** 项目仓库地址（账户菜单二维码与帮助链接），注入为 __REPO_URL__ */
  repoUrl?: string
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
}

/** 创建构建配置，支持自定义 API 地址和开发服务器选项 */
export const createConfig = ({
  apiOrigin = 'https://api.deepseek.com',
  repoUrl = 'https://github.com/zcgg2001/deepseek-chat-test',
  devServer,
}: ConfigOptions = {}): Configuration => ({
  mode: dev ? 'development' : 'production',
  entry: './src/main.tsx',
  output: {
    path: path.resolve(root, 'dist'),
    // 运行时按当前脚本地址推导资源路径，file:// 下异步 chunk、字体都按相对位置加载
    publicPath: 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  optimization: { minimize: !dev },
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': version },
      minify: !dev,
    }),
    new rspack.DefinePlugin({
      __API_ORIGIN__: JSON.stringify(apiOrigin),
      __REPO_URL__: JSON.stringify(repoUrl),
    }),
    new AppleTouchIconPlugin(),
    new rspack.CopyRspackPlugin({
      patterns: [
        { from: path.resolve(root, 'LICENSE'), to: 'LICENSE', toType: 'file' },
        {
          from: path.resolve(root, 'src/assets/icons/favicon.svg'),
          to: 'static/icons/favicon.svg',
          toType: 'file',
        },
      ],
    }),
  ],
  performance: { hints: false },
  devServer: { port: 8090, ...devServer },
})

// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig())
