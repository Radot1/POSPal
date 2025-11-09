const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await chromium.launch();
})();
