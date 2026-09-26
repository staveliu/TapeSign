// Edge is convenient locally; CI can use an installed Playwright Chromium.
export const browserOptions = () => ({headless:true,...(process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? {} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'})});
export const testBase = process.env.TEST_BASE_URL || 'http://127.0.0.1:18740';
