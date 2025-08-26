// ===== STANDALONE SERVER =====
// This file loads the module.js and starts a standalone server
// All application logic is in module.js - this just adds app.listen()

// Set standalone mode (no embedded flag)
process.env.EMBEDDED_MODE = 'false';

const APP_ID = 'cmel82l6s03t26l7g6fqhsx2j';
const createAppModule = require('./module.js');

// Create the app instance by passing APP_ID to the module factory
const app = createAppModule(APP_ID);

const PORT = process.env.PORT || 3001;

// Start standalone server
const server = app.listen(PORT, () => {
  console.log(`🚀 عيادة العلاج النطقي - د. وفاق وهبي running on http://localhost:${PORT}`);
});

module.exports = app;