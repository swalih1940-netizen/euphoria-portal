const axios = require('axios');
const https = require('https');

const FESTFLOW_BASE_URL = process.env.FESTFLOW_BASE_URL || 'https://euphoria.festfloww.com/api/public';
const FESTFLOW_API_KEY = process.env.FESTFLOW_API_KEY || 'da7f60cc99a7b59e264186130f6cb70c4f493eb0c1fa287ff4ae9d7f42235d52';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true
});

async function runApiInspection() {
    console.log('====================================================');
    console.log('FESTFLOW API JSON STRUCTURE INSPECTION');
    console.log(`Base URL: ${FESTFLOW_BASE_URL}`);
    console.log('====================================================\n');

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'x-api-key': FESTFLOW_API_KEY,
        'Accept': 'application/json'
    };

    // 1. Fetch Team Points (/team-points)
    try {
        console.log('>>> FETCHING: GET /team-points');
        const resTeamPoints = await axios.get(`${FESTFLOW_BASE_URL}/team-points`, { headers, httpsAgent, timeout: 8000 });
        console.log('STATUS:', resTeamPoints.status);
        console.log('RESPONSE DATA:');
        console.log(JSON.stringify(resTeamPoints.data, null, 2));
    } catch (err) {
        console.error('ERROR GET /team-points:', err.message, err.response?.data);
    }

    console.log('\n----------------------------------------------------\n');

    // 2. Fetch Competitions (/competitions)
    let competitions = [];
    try {
        console.log('>>> FETCHING: GET /competitions');
        const resComps = await axios.get(`${FESTFLOW_BASE_URL}/competitions`, { headers, httpsAgent, timeout: 8000 });
        console.log('STATUS:', resComps.status);
        console.log('RESPONSE DATA:');
        console.log(JSON.stringify(resComps.data, null, 2));

        if (resComps.data && Array.isArray(resComps.data.data)) {
            competitions = resComps.data.data;
        } else if (Array.isArray(resComps.data)) {
            competitions = resComps.data;
        }
    } catch (err) {
        console.error('ERROR GET /competitions:', err.message, err.response?.data);
    }

    console.log('\n----------------------------------------------------\n');

    // 3. Fetch Results for Each Competition (/competitions/:id/results)
    if (competitions.length > 0) {
        for (const comp of competitions) {
            const compId = comp.id || comp._id || comp.competitionId;
            const compName = comp.name || comp.title || compId;
            console.log(`>>> FETCHING RESULTS FOR COMPETITION: "${compName}" (ID: ${compId})`);
            try {
                const resResults = await axios.get(`${FESTFLOW_BASE_URL}/competitions/${compId}/results`, { headers, httpsAgent, timeout: 8000 });
                console.log(`STATUS (${compId}):`, resResults.status);
                console.log('RESULTS RESPONSE DATA:');
                console.log(JSON.stringify(resResults.data, null, 2));
            } catch (err) {
                console.error(`ERROR GET /competitions/${compId}/results:`, err.message, err.response?.data);
            }
            console.log('\n----------------------------------------------------\n');
        }
    } else {
        console.log('No competitions found to fetch results for.');
    }

    console.log('====================================================');
    console.log('INSPECTION COMPLETE');
    console.log('====================================================');
}

runApiInspection();
