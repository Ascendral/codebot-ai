const pkg = require('../package.json') as { version: string };

export const VERSION: string = pkg.version;
