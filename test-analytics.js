require('dotenv').config();
const { getLiveData } = require('./Agent/analyticsAgent.js');
async function test() {
   try {
       const data = await getLiveData();
       console.log("Analytics data:", data);
   } catch (e) {
       console.error("Crash:", e);
   }
}
test();
