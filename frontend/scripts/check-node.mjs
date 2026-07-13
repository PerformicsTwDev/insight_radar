// Fail-fast Node version guard (mirrors package.json "engines.node": ">=22").
// Runs as the frontend `preinstall` script so an unsupported toolchain is caught
// before any dependency is fetched. Keep this dependency-free (runs pre-install).
const major = Number(process.versions.node.split('.')[0]);

if (Number.isNaN(major) || major < 22) {
  console.error(
    `\n[frontend] Node >= 22 is required, but found ${process.version}.\n` +
      `Upgrade Node (e.g. \`nvm install 22 && nvm use 22\`) and retry.\n`,
  );
  process.exit(1);
}
