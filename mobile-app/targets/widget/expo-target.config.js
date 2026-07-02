/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: 'widget',
  name: 'CardifyWidget',
  displayName: 'Cardify',
  colors: {
    $accent: '#497254', // moss-600, matches the mobile app's primary color
    $widgetBackground: '#FFFDF8', // cream surface color
  },
  frameworks: ['SwiftUI', 'WidgetKit'],
  deploymentTarget: '16.0', // accessoryRectangular (Lock Screen) widgets require iOS 16+
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
})
