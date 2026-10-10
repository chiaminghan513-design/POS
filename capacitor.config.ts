import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.eduvo.pos',
  appName: 'Eduvo POS',
  webDir: 'www',
  plugins: {
    SystemBars: {
      // MainActivity owns status/navigation-bar and keyboard insets.
      insetsHandling: 'disable',
      style: 'DARK'
    }
  },
  // Local USB development: localhost is forwarded to the laptop backend.
  server: { androidScheme: 'http' }
};

export default config;
