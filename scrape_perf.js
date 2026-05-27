const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
  const page = await browser.newPage();
  // Capture console messages
  const fs = require('fs');
  const outPath = 'perf_output.txt';
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('ChatBubble render')) {
      if (text.includes('ChatBubble render')) {
        console.log('PERF:', text);
        fs.appendFileSync(outPath, text + '\n');
      }
    }
  });
  await page.goto('http://localhost:3001/foxy', {waitUntil: 'networkidle2'});
  // Wait a few seconds to allow rendering
  await new Promise(r => setTimeout(r, 8000));
  await browser.close();
})();
