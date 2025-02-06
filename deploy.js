const { execSync } = require("child_process");
const { copyFileSync } = require("fs");

execSync("npm run build");
copyFileSync("./index.d.ts", "./dist/index.d.ts");
copyFileSync("./xdg-open", "./dist/xdg-open");
