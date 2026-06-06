# Personal website
Super simple static personal site with some trippy effects. It can be accessed under [kacper.grabow.ski](https://kacper.grabow.ski).

Each load picks a random saturated background color and a complementary foreground (looping until WCAG contrast is acceptable), then hue-rotates the portrait to match. Click the photo to regenerate.

## Stack
- React 19 (functional component + hooks)
- Vite for dev/build
- Vitest for tests
- chroma-js for color math
- FontAwesome for icons
- Hosted as a static S3 bucket

## Local setup
```
git clone https://github.com/grappeq/personal-site.git
cd personal-site
npm install
npm run dev
```
Dev server listens on http://localhost:5173.

## Build & deploy
```
npm run build
npm run deploy
```
`build` outputs to `dist/`; `deploy` syncs `dist/` to the S3 bucket.

## Tests
```
npm test
```
