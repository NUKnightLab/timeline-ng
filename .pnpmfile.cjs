// Allow build scripts for native addons and preprocessors
function readPackage(pkg) {
  return pkg;
}

module.exports = { hooks: { readPackage } };
