// The public address of the site. Node modules, the build and the feedback Worker take it from here.
// Browser files that load without a build step (app.js, analytics.js, search-tracking.js, 404.html) keep
// literal copies; test/site.test.mjs fails when they differ from these values.
export const origin = 'https://agent-hub-community.github.io';
// GitHub Pages serves the project site under the repository name.
export const basePath = '/newspaper/';
export const site = `${origin}${basePath}`;
