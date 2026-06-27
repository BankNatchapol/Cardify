module.exports = {
  appId: 'com.cardify.app',
  productName: 'Cardify',
  directories: {
    output: 'dist/app'
  },
  mac: {
    category: 'public.app-category.education',
    target: ['dmg', 'zip']
  },
  files: [
    'dist/renderer/**/*',
    'electron/**/*',
    'src/lib/**/*',
    'node_modules/**/*',
    'package.json'
  ]
}
