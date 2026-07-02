#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const sourceIcon = path.join(projectRoot, 'assets', 'icon.png')
const generatedIcon = path.join(projectRoot, 'assets', 'app-icon.png')
const iosIcon = path.join(
  projectRoot,
  'ios',
  'CardifyMobile',
  'Images.xcassets',
  'AppIcon.appiconset',
  'App-Icon-1024x1024@1x.png'
)

function main () {
  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`Missing source icon: ${path.relative(projectRoot, sourceIcon)}`)
  }

  ensureSips()
  fs.mkdirSync(path.dirname(generatedIcon), { recursive: true })
  resizePng(sourceIcon, generatedIcon)

  if (fs.existsSync(path.dirname(iosIcon))) {
    fs.copyFileSync(generatedIcon, iosIcon)
  }

  const size = readPngSize(generatedIcon)
  console.log(`Prepared app icon: ${path.relative(projectRoot, generatedIcon)} (${size.width}x${size.height})`)
  if (fs.existsSync(iosIcon)) {
    console.log(`Updated iOS icon asset: ${path.relative(projectRoot, iosIcon)}`)
  }
}

function ensureSips () {
  try {
    execFileSync('sips', ['--version'], { stdio: 'ignore' })
  } catch (err) {
    throw new Error('Icon resizing requires macOS `sips`. On another OS, create mobile-app/assets/app-icon.png as a 1024x1024 PNG manually.')
  }
}

function resizePng (input, output) {
  execFileSync('sips', [
    '--resampleHeightWidth',
    '1024',
    '1024',
    input,
    '--out',
    output
  ], { stdio: 'ignore' })
}

function readPngSize (filePath) {
  const output = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], {
    encoding: 'utf8'
  })
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1])
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1])
  return { width, height }
}

if (require.main === module) {
  try {
    main()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}

module.exports = {
  main,
  readPngSize,
  resizePng
}
