# Commerce gateway (sandbox/testnet only). Persistent state lives in PostgreSQL via DATABASE_URL.
# The payer client is a separate process/image concern and is NOT included here.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY demo ./demo
COPY src ./src
COPY scripts ./scripts
COPY web ./web
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production APP_ENV=sandbox HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright SHOPIFY_BROWSER_EXECUTABLE=/usr/local/bin/shopify-chromium
RUN npm ci --omit=dev && npx playwright-core install --with-deps chromium && chmod -R a+rX /ms-playwright && node --input-type=module -e "import {chromium} from 'playwright-core'; import {symlinkSync} from 'node:fs'; symlinkSync(chromium.executablePath(),'/usr/local/bin/shopify-chromium')"
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
# Verify the installed browser can launch as the actual runtime user without provider traffic.
RUN node --input-type=module -e "import {chromium} from 'playwright-core'; const browser=await chromium.launch({executablePath:process.env.SHOPIFY_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']}); const page=await browser.newPage(); await page.goto('about:blank'); await browser.close(); console.log('Chromium runtime-user smoke passed')"
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
