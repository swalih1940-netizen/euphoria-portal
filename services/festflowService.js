/**
 * FestFlow API Service Module for Sirajul Irfan (Event Euphoria)
 * Base URL: https://euphoria.festfloww.com/api/public
 */

const axios = require('axios');
const https = require('https');

// Helper getters to dynamically and safely read/clean environment variables
function getBaseUrl() {
    const raw = process.env.FESTFLOW_BASE_URL || 'https://euphoria.festfloww.com/api/public';
    return String(raw).trim().replace(/^["']+|["']+$/g, '').replace(/\/+$/, '');
}

function getApiKey() {
    const raw = process.env.FESTFLOW_API_KEY || 'da7f60cc99a7b59e264186130f6cb70c4f493eb0c1fa287ff4ae9d7f42235d52';
    return String(raw).trim().replace(/^["']+|["']+$/g, '');
}

function getRequestTimeoutMs() {
    return parseInt(process.env.FESTFLOW_TIMEOUT_MS, 10) || 6000;
}

// In-Memory Short-Lived Cache (30s TTL) for Serverless Optimization & Error Resilience
const CACHE_TTL_MS = 30 * 1000;
const cacheStore = {
    competitions: null,
    competitionsTime: 0,
    teamPoints: null,
    teamPointsTime: 0
};

// Custom HTTPS Agent: keepAlive: false is essential for Serverless/Vercel
// to avoid ECONNRESET and socket hangup errors when Lambda containers freeze/unfreeze
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: false
});

// Fallback collections exported as default structure
const FALLBACK_HOUSES = [
    {
        name: 'Team fanora',
        rank: 1,
        points: 0,
        progress: 0,
        captain: 'Muhammed Afeef',
        badge: 'Current Lead',
        badgeClass: 'bg-amber-400 text-slate-950',
        barGradient: 'from-amber-500 to-amber-300'
    },
    {
        name: 'Team zahora',
        rank: 2,
        points: 0,
        progress: 0,
        captain: 'Muhammed Jabir vk',
        badge: 'Runner Up',
        badgeClass: 'bg-slate-800 text-emerald-400 border border-emerald-500/30',
        barGradient: 'from-emerald-500 to-emerald-300'
    }
];
const FALLBACK_COMPETITIONS = [];

/**
 * Fast & Robust API Request helper using Axios with HTTPS Agent
 */
async function fetchWithAxios(url, options = {}, maxRetries = 2, timeoutMs = null) {
    const apiKey = getApiKey();
    const effectiveTimeout = timeoutMs || getRequestTimeoutMs();
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'x-api-key': apiKey,
                    'Accept': 'application/json, text/plain, */*',
                    'Cache-Control': 'no-cache',
                    ...options.headers
                },
                httpsAgent: httpsAgent,
                timeout: effectiveTimeout,
                validateStatus: () => true
            });
            return response;
        } catch (err) {
            lastError = err;
            const errCode = err.code || (err.cause ? err.cause.code : 'UNKNOWN');

            console.warn(`[FestFlow API Axios Attempt ${attempt}/${maxRetries} Warning]:`, {
                url: url,
                message: err.message,
                code: errCode
            });

            if (errCode === 'ENOTFOUND') {
                break;
            }

            if (attempt < maxRetries) {
                await new Promise(res => setTimeout(res, 350 * attempt));
            }
        }
    }
    throw lastError || new Error(`FestFlow Request Failed for ${url}`);
}

/**
 * Helper to extract array from any deep JSON response path
 */
function extractArrayPayload(rawData, primaryKeys = []) {
    if (!rawData) return [];
    if (Array.isArray(rawData)) return rawData;

    if (typeof rawData === 'object') {
        for (const key of primaryKeys) {
            if (Array.isArray(rawData[key])) return rawData[key];
        }

        const commonKeys = [
            'teams', 'scores', 'competitions', 'data', 'results', 'items', 'payload', 
            'list', 'records', 'events', 'published', 'houses', 'standings', 'participants', 'winners'
        ];
        for (const key of commonKeys) {
            if (Array.isArray(rawData[key])) return rawData[key];
        }

        const wrapperKeys = ['data', 'payload', 'result', 'response', 'body'];
        for (const wrapKey of wrapperKeys) {
            const nested = rawData[wrapKey];
            if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
                for (const key of primaryKeys.concat(commonKeys)) {
                    if (Array.isArray(nested[key])) return nested[key];
                }
                for (const k of Object.keys(nested)) {
                    if (Array.isArray(nested[k])) return nested[k];
                }
            }
        }

        for (const k of Object.keys(rawData)) {
            if (Array.isArray(rawData[k])) return rawData[k];
        }
    }
    return [];
}

/**
 * Configurable Team/House Name Mapping Dictionary
 * Maps raw API captain/manager names or team IDs to explicit display House/Team names.
 */
let CUSTOM_TEAM_MAP = {};
if (process.env.FESTFLOW_TEAM_MAP) {
    try {
        CUSTOM_TEAM_MAP = JSON.parse(process.env.FESTFLOW_TEAM_MAP);
    } catch (e) {
        console.warn('[FestFlow Service] Invalid FESTFLOW_TEAM_MAP JSON in env:', e.message);
    }
}

const DEFAULT_TEAM_MAPPING = {
    'MUHAMMED AFEEF': 'Team fanora',
    'MUHAMMED AFEEF VK': 'Team fanora',
    'AFEEF': 'Team fanora',
    'MUHAMMED JABIR VK': 'Team zahora',
    'MUHAMMED JABIR': 'Team zahora',
    'JABIR': 'Team zahora',
    'JABIR VK': 'Team zahora',
    '1': 'Team fanora',
    '2': 'Team zahora',
    'TEAM_1': 'Team fanora',
    'TEAM_2': 'Team zahora',
    'TEAM 1': 'Team fanora',
    'TEAM 2': 'Team zahora',
    'HOUSE 1': 'Team fanora',
    'HOUSE 2': 'Team zahora',
    'FANORA': 'Team fanora',
    'ZAHORA': 'Team zahora',
    'TEAM FANORA': 'Team fanora',
    'TEAM ZAHORA': 'Team zahora',
    'AFEEF HOUSE': 'Team fanora',
    'JABIR HOUSE': 'Team zahora'
};

/**
 * Helper to resolve raw API team/captain/manager names or IDs into correct Team display names
 */
function resolveMappedTeamName(rawName) {
    if (!rawName || rawName === '-') return '-';
    const trimmed = String(rawName).replace(/\s*\([^)]*\)/g, '').trim();
    if (!trimmed) return '-';

    const upper = trimmed.toUpperCase();

    // 1. Check env custom map first
    if (CUSTOM_TEAM_MAP[upper]) return CUSTOM_TEAM_MAP[upper];
    if (CUSTOM_TEAM_MAP[trimmed]) return CUSTOM_TEAM_MAP[trimmed];

    // 2. Check default mapping dictionary exact match
    if (DEFAULT_TEAM_MAPPING[upper]) return DEFAULT_TEAM_MAPPING[upper];

    // 3. Keyword / Manager / House matching
    if (upper.includes('AFEEF') || upper.includes('FANORA')) {
        return 'Team fanora';
    }
    if (upper.includes('JABIR') || upper.includes('ZAHORA')) {
        return 'Team zahora';
    }

    // Check combined maps for other partial keys
    const combinedMaps = { ...DEFAULT_TEAM_MAPPING, ...CUSTOM_TEAM_MAP };
    for (const [key, mappedVal] of Object.entries(combinedMaps)) {
        if (key.length >= 3 && (upper === key || upper.includes(key) || key.includes(upper))) {
            return mappedVal;
        }
    }

    // 4. Fallback: If rawName doesn't contain team indicators, format cleanly as "Team ..."
    if (!trimmed.toLowerCase().includes('team') &&
        !trimmed.toLowerCase().includes('house') &&
        !trimmed.toLowerCase().includes('district') &&
        !trimmed.toLowerCase().includes('zone') &&
        !trimmed.toLowerCase().includes('group') &&
        !trimmed.toLowerCase().includes('dars') &&
        !trimmed.toLowerCase().includes('institution')) {
        return `Team ${trimmed}`;
    }

    return trimmed;
}

/**
 * Robust Multi-Layer Team/Manager Property Extraction
 * Strictly extracts team/house/district/manager name from FestFlow API result objects.
 */
function extractTeamName(w) {
    if (!w) return '-';
    if (typeof w === 'string') return resolveMappedTeamName(w);

    // 0. Check explicit manager / captain properties first
    const managerOrCaptain =
        (w.managerName && typeof w.managerName === 'string' ? w.managerName : null) ||
        (w.manager_name && typeof w.manager_name === 'string' ? w.manager_name : null) ||
        (w.manager && typeof w.manager === 'string' ? w.manager : (w.manager?.name || w.manager?.title)) ||
        (w.teamManager && typeof w.teamManager === 'string' ? w.teamManager : null) ||
        (w.team_manager && typeof w.team_manager === 'string' ? w.team_manager : null) ||
        (w.captainName && typeof w.captainName === 'string' ? w.captainName : null) ||
        (w.captain_name && typeof w.captain_name === 'string' ? w.captain_name : null) ||
        (w.captain && typeof w.captain === 'string' ? w.captain : (w.captain?.name || w.captain?.title));

    if (managerOrCaptain && typeof managerOrCaptain === 'string' && managerOrCaptain.trim()) {
        const mappedManager = resolveMappedTeamName(managerOrCaptain);
        if (mappedManager && mappedManager !== '-' && (mappedManager === 'Team fanora' || mappedManager === 'Team zahora')) {
            return mappedManager;
        }
    }

    // 1. Check explicit house / district / institution / group properties first
    const explicitHouseOrDistrict =
        (w.houseName && typeof w.houseName === 'string' ? w.houseName : null) ||
        (w.house_name && typeof w.house_name === 'string' ? w.house_name : null) ||
        (typeof w.house === 'string' ? w.house : (w.house?.name || w.house?.title || w.house?.houseName)) ||
        (w.districtName && typeof w.districtName === 'string' ? w.districtName : null) ||
        (w.district_name && typeof w.district_name === 'string' ? w.district_name : null) ||
        (typeof w.district === 'string' ? w.district : (w.district?.name || w.district?.title || w.district?.districtName)) ||
        (w.institutionName && typeof w.institutionName === 'string' ? w.institutionName : null) ||
        (w.institution_name && typeof w.institution_name === 'string' ? w.institution_name : null) ||
        (typeof w.institution === 'string' ? w.institution : (w.institution?.name || w.institution?.title)) ||
        (w.groupName && typeof w.groupName === 'string' ? w.groupName : null) ||
        (w.group_name && typeof w.group_name === 'string' ? w.group_name : null) ||
        (typeof w.group === 'string' ? w.group : (w.group?.name || w.group?.title)) ||
        (w.team?.houseName || w.team?.house_name || w.team?.house || w.team?.districtName || w.team?.district_name || w.team?.district || w.team?.groupName || w.team?.group_name || w.team?.group);

    if (explicitHouseOrDistrict && typeof explicitHouseOrDistrict === 'string' && explicitHouseOrDistrict.trim()) {
        return resolveMappedTeamName(explicitHouseOrDistrict);
    }

    // 2. Check team ID / code mapping if teamId or team_id exists
    const teamIdOrCode = w.teamId || w.team_id || w.houseId || w.house_id || w.teamCode || w.team_code || w.houseCode || w.house_code;
    if (teamIdOrCode) {
        const idStr = String(teamIdOrCode).toUpperCase();
        if (CUSTOM_TEAM_MAP[idStr]) return CUSTOM_TEAM_MAP[idStr];
        if (DEFAULT_TEAM_MAPPING[idStr]) return DEFAULT_TEAM_MAPPING[idStr];
        const mappedId = resolveMappedTeamName(idStr);
        if (mappedId && mappedId !== idStr && mappedId !== '-') {
            return mappedId;
        }
    }

    // 3. Check teamName / team_name / teamTitle / team object or string, or object name/title if not a participant object
    let rawTeam =
        (w.teamName && typeof w.teamName === 'string' ? w.teamName : null) ||
        (w.team_name && typeof w.team_name === 'string' ? w.team_name : null) ||
        (w.teamTitle && typeof w.teamTitle === 'string' ? w.teamTitle : null) ||
        (typeof w.team === 'string' ? w.team : (w.team?.name || w.team?.title || w.team?.houseName || w.team?.districtName)) ||
        (w.name && typeof w.name === 'string' && !w.participantName && !w.candidateName && !w.studentName && !w.student_name ? w.name : null) ||
        (w.title && typeof w.title === 'string' && !w.participantName && !w.candidateName && !w.studentName && !w.student_name ? w.title : null) ||
        (managerOrCaptain ? String(managerOrCaptain) : null) ||
        (teamIdOrCode ? String(teamIdOrCode) : null);

    if (!rawTeam || rawTeam === 'undefined' || rawTeam === 'null') {
        return '-';
    }

    if (typeof rawTeam !== 'string') {
        rawTeam = String(rawTeam);
    }

    return resolveMappedTeamName(rawTeam);
}

/**
 * Fetch Team Points / House Standings dynamically aggregated from FestFlow API team-points and competition results
 */
async function fetchTeamPoints(existingCompetitions = null) {
    const baseUrl = getBaseUrl();
    const endpoint = `${baseUrl}/team-points`;

    // Check memory cache first (if not forcing fresh or if recent)
    const now = Date.now();
    if (!existingCompetitions && cacheStore.teamPoints && (now - cacheStore.teamPointsTime < CACHE_TTL_MS)) {
        return cacheStore.teamPoints;
    }

    let apiScoresMap = {};

    try {
        console.log(`[FestFlow API Axios Request] GET ${endpoint}`);
        const response = await fetchWithAxios(endpoint, {}, 2);

        if (response && response.status === 200) {
            const rawData = response.data;
            console.log('[FESTFLOW RAW TEAM POINTS API RESPONSE]:\n', typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2));

            let dataArray = [];
            if (rawData && rawData.data) {
                if (Array.isArray(rawData.data.teams)) dataArray = rawData.data.teams;
                else if (Array.isArray(rawData.data.scores)) dataArray = rawData.data.scores;
                else if (Array.isArray(rawData.data.standings)) dataArray = rawData.data.standings;
                else if (Array.isArray(rawData.data.houses)) dataArray = rawData.data.houses;
                else if (Array.isArray(rawData.data)) dataArray = rawData.data;
            }
            if (dataArray.length === 0) {
                dataArray = extractArrayPayload(rawData, ['teams', 'scores', 'houses', 'standings']);
            }

            dataArray.forEach(item => {
                const tName = extractTeamName(item);
                const pts = Number(item.point !== undefined && item.point !== null ? item.point : (item.points !== undefined && item.points !== null ? item.points : (item.score || 0))) || 0;
                if (tName && tName !== '-') {
                    apiScoresMap[tName] = Math.max(apiScoresMap[tName] || 0, pts);
                }
            });
        } else {
            console.error(`[FestFlow API Error] GET ${endpoint} returned status ${response?.status}:`, response?.data);
        }
    } catch (err) {
        console.warn(`[FestFlow API Catch] /team-points unreachable (${err.message}).`);
    }

    // Dynamic aggregation from published competition results
    let comps = existingCompetitions;
    if (!Array.isArray(comps)) {
        try {
            comps = await fetchCompetitions();
        } catch (e) {
            comps = [];
        }
    }

    let compScoresMap = {};
    if (Array.isArray(comps)) {
        comps.forEach(comp => {
            if (Array.isArray(comp.winners)) {
                comp.winners.forEach(w => {
                    const tName = extractTeamName(w);
                    const pts = Number(w.points !== undefined && w.points !== null && w.points !== '-' ? w.points : (w.point !== undefined && w.point !== null && w.point !== '-' ? w.point : (w.mark !== undefined && w.mark !== null && w.mark !== '-' ? w.mark : (w.score || 0)))) || 0;
                    if (tName && tName !== '-') {
                        compScoresMap[tName] = (compScoresMap[tName] || 0) + pts;
                    }
                });
            }
        });
    }

    // Ensure primary mapped teams are always included
    const knownTeams = ['Team fanora', 'Team zahora'];
    const allTeamNames = Array.from(new Set([...knownTeams, ...Object.keys(apiScoresMap), ...Object.keys(compScoresMap)]));

    const aggregatedList = allTeamNames.map(teamName => {
        const apiPts = apiScoresMap[teamName] || 0;
        const compPts = compScoresMap[teamName] || 0;
        const finalPts = Math.max(apiPts, compPts);

        return {
            name: teamName,
            points: finalPts
        };
    });

    // Sort teams descending by real-time total points
    aggregatedList.sort((a, b) => b.points - a.points);

    const maxPoints = Math.max(...aggregatedList.map(t => t.points), 1);

    const calculatedHouses = aggregatedList.map((item, idx) => {
        const rank = idx + 1;
        const progress = Math.min(100, Math.round((item.points / maxPoints) * 100));

        return {
            name: item.name,
            rank: rank,
            points: item.points,
            progress: progress,
            captain: item.name === 'Team fanora' ? 'Muhammed Afeef' : (item.name === 'Team zahora' ? 'Muhammed Jabir vk' : ''),
            badge: rank === 1 ? 'Current Lead' : (rank === 2 ? 'Runner Up' : ''),
            badgeClass: rank === 1 ? 'bg-amber-400 text-slate-950' : (rank === 2 ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-300'),
            barGradient: rank === 1 ? 'from-amber-500 to-amber-300' : (rank === 2 ? 'from-emerald-500 to-emerald-300' : 'from-cyan-500 to-cyan-300')
        };
    });

    // Cache the successful aggregation
    cacheStore.teamPoints = calculatedHouses;
    cacheStore.teamPointsTime = Date.now();

    return calculatedHouses;
}

/**
 * Fetch Published Competitions & Results strictly from FestFlow API
 */
async function fetchCompetitions() {
    const baseUrl = getBaseUrl();
    const endpoint = `${baseUrl}/competitions`;

    // Check memory cache first
    const now = Date.now();
    if (cacheStore.competitions && (now - cacheStore.competitionsTime < CACHE_TTL_MS)) {
        return cacheStore.competitions;
    }

    try {
        console.log(`[FestFlow API Axios Request] GET ${endpoint}`);
        const response = await fetchWithAxios(endpoint, {}, 2);

        if (response && response.status === 200) {
            const rawData = response.data;
            console.log('[FESTFLOW RAW COMPETITIONS API RESPONSE]:\n', typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2));

            let compArray = [];
            if (rawData && Array.isArray(rawData.data)) {
                compArray = rawData.data;
            } else if (Array.isArray(rawData)) {
                compArray = rawData;
            } else {
                compArray = extractArrayPayload(rawData, ['competitions', 'items', 'results', 'data']);
            }

            if (Array.isArray(compArray) && compArray.length > 0) {
                console.log(`[FestFlow API Live Data] Retaining ${compArray.length} raw competition item(s) from API.`);

                const mappedCompetitions = await Promise.all(compArray.map(async (comp, idx) => {
                    const compId = comp.id || comp._id || comp.competitionId;
                    let rawWinners = Array.isArray(comp.winners) ? comp.winners :
                                     (Array.isArray(comp.results) ? comp.results :
                                     (Array.isArray(comp.participants) ? comp.participants : []));

                    // Query sub-endpoint for competition results (/competitions/:id/results)
                    if (compId) {
                        try {
                            const subUrl = `${baseUrl}/competitions/${compId}/results`;
                            console.log(`[FestFlow API Axios Sub-Request] GET ${subUrl}`);
                            const subResponse = await fetchWithAxios(subUrl, {}, 2, 4000);
                            if (subResponse && subResponse.status === 200) {
                                const subData = subResponse.data;
                                console.log(`[FESTFLOW RAW RESULTS API RESPONSE for ${compId}]:\n`, typeof subData === 'string' ? subData : JSON.stringify(subData, null, 2));
                                let extracted = [];
                                if (subData && Array.isArray(subData.data)) {
                                    extracted = subData.data;
                                } else {
                                    extracted = extractArrayPayload(subData, ['winners', 'results', 'participants', 'ranks', 'data', 'items']);
                                }
                                if (extracted && extracted.length > 0) {
                                    rawWinners = extracted;
                                }
                            }
                        } catch (subErr) {
                            console.warn(`[FestFlow API Sub-Fetch Warning for ${compId}]: ${subErr.message}`);
                        }
                    }

                    let categoryName = comp.category || comp.categoryName || comp.catName || comp.stageCategory || 'ALPHA ZONE';
                    if (typeof categoryName === 'object') {
                        categoryName = categoryName.name || categoryName.title || categoryName.label || 'ALPHA ZONE';
                    }

                    let itemCode = String(comp.resultNumber || comp.code || comp.itemCode || comp.resultNo || comp.competitionCode || (idx + 1));
                    if (/^\d+$/.test(itemCode) && itemCode.length < 2) {
                        itemCode = itemCode.padStart(2, '0');
                    }

                    return {
                        ...comp,
                        id: compId || `c_${idx + 1}`,
                        code: itemCode,
                        formattedCode: String(itemCode).padStart(2, '0'),
                        title: comp.name || comp.title || comp.itemName || comp.competitionName || 'Competition Item',
                        category: categoryName,
                        stage: comp.stage || comp.venue || comp.location || comp.type || 'Main Stage',
                        status: comp.status || 'Published',
                        winners: rawWinners.map((w, wIdx) => {
                            const rankVal = w.rank !== undefined ? w.rank : (w.position !== undefined ? w.position : (w.place || w.prize || (wIdx + 1)));

                            let prizeVal = w.prize;
                            if (!prizeVal) {
                                if (rankVal === 1 || String(rankVal) === '1') prizeVal = '1st';
                                else if (rankVal === 2 || String(rankVal) === '2') prizeVal = '2nd';
                                else if (rankVal === 3 || String(rankVal) === '3') prizeVal = '3rd';
                                else prizeVal = `${rankVal}th`;
                            }

                            const chestNoVal = w.chestNo || w.chest_no || w.chestNumber || w.code || w.chest || w.candidateCode || w.candidateNo || '-';
                            const pName = w.participantName || w.participant || w.name || w.candidateName || w.studentName || w.student_name || w.candidate || 'Participant';
                            const rawTeamName = extractTeamName(w);
                            let displayTeam = rawTeamName;
                            if (displayTeam && displayTeam !== '-' && !displayTeam.toLowerCase().includes('team') && !displayTeam.toLowerCase().includes('house') && !displayTeam.toLowerCase().includes('district') && !displayTeam.toLowerCase().includes('zone')) {
                                displayTeam = `Team ${displayTeam}`;
                            }

                            let gradeVal = w.grade || w.gradeName;
                            if (!gradeVal || gradeVal === '-' || gradeVal === 'none' || gradeVal === 'null' || gradeVal === 'undefined') {
                                gradeVal = '';
                            }

                            const pointsVal = (w.point !== undefined && w.point !== null) ? w.point : ((w.points !== undefined && w.points !== null) ? w.points : ((w.mark !== undefined && w.mark !== null) ? w.mark : ((w.score !== undefined && w.score !== null) ? w.score : '-')));

                            const rStr = String(prizeVal || rankVal).toLowerCase();
                            const isFirst = rankVal === 1 || rStr.includes('1st') || rStr === '1' || rStr.includes('first');
                            const isSecond = rankVal === 2 || rStr.includes('2nd') || rStr === '2' || rStr.includes('second');
                            const isThird = rankVal === 3 || rStr.includes('3rd') || rStr === '3' || rStr.includes('third');

                            return {
                                ...w,
                                prize: prizeVal,
                                rank: rankVal,
                                isFirst: isFirst,
                                isSecond: isSecond,
                                isThird: isThird,
                                chestNo: chestNoVal,
                                participant: pName,
                                name: pName,
                                team: displayTeam,
                                rawTeamName: rawTeamName,
                                teamName: displayTeam,
                                district: displayTeam,
                                location: '',
                                grade: gradeVal,
                                points: pointsVal
                            };
                        })
                    };
                }));

                // Update cache store
                cacheStore.competitions = mappedCompetitions;
                cacheStore.competitionsTime = Date.now();

                return mappedCompetitions;
            }

            console.warn(`[FestFlow API Warning] 200 OK received from /competitions but zero items found in API payload.`);
            if (cacheStore.competitions && cacheStore.competitions.length > 0) {
                console.log(`[FestFlow Service] Using ${cacheStore.competitions.length} cached competition item(s) as resilient fallback.`);
                return cacheStore.competitions;
            }
            return [];
        }

        console.error(`[FestFlow API Error] GET ${endpoint} returned status ${response?.status}:`, response?.data);
        if (cacheStore.competitions && cacheStore.competitions.length > 0) {
            return cacheStore.competitions;
        }
        return [];
    } catch (err) {
        console.warn(`[FestFlow API Catch] /competitions error (${err.message}).`);
        if (cacheStore.competitions && cacheStore.competitions.length > 0) {
            console.log(`[FestFlow Service] Returning cached competitions following network catch.`);
            return cacheStore.competitions;
        }
        return [];
    }
}

/**
 * Diagnostic utility to verify FestFlow connectivity, credentials, and API payloads
 */
async function runDiagnostics() {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    const maskedKey = apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)} (length: ${apiKey.length})` : 'MISSING';

    const report = {
        timestamp: new Date().toISOString(),
        config: {
            baseUrl: baseUrl,
            apiKeyConfigured: !!apiKey,
            apiKeyMasked: maskedKey,
            timeoutMs: getRequestTimeoutMs(),
            isVercel: !!process.env.VERCEL,
            nodeEnv: process.env.NODE_ENV
        },
        endpoints: {}
    };

    // Test /team-points
    const startTp = Date.now();
    try {
        const resTp = await fetchWithAxios(`${baseUrl}/team-points`, {}, 1, 5000);
        report.endpoints.teamPoints = {
            status: resTp?.status,
            latencyMs: Date.now() - startTp,
            dataPresent: !!resTp?.data,
            sample: resTp?.data?.data ? Object.keys(resTp.data.data) : null
        };
    } catch (e) {
        report.endpoints.teamPoints = {
            error: e.message,
            code: e.code || 'UNKNOWN',
            latencyMs: Date.now() - startTp
        };
    }

    // Test /competitions
    const startComp = Date.now();
    try {
        const resComp = await fetchWithAxios(`${baseUrl}/competitions`, {}, 1, 5000);
        const compCount = Array.isArray(resComp?.data?.data) ? resComp.data.data.length : (Array.isArray(resComp?.data) ? resComp.data.length : 0);
        report.endpoints.competitions = {
            status: resComp?.status,
            latencyMs: Date.now() - startComp,
            competitionsFound: compCount
        };
    } catch (e) {
        report.endpoints.competitions = {
            error: e.message,
            code: e.code || 'UNKNOWN',
            latencyMs: Date.now() - startComp
        };
    }

    report.overallStatus = (report.endpoints.teamPoints?.status === 200 && report.endpoints.competitions?.status === 200) ? 'ok' : 'degraded';
    return report;
}

module.exports = {
    fetchTeamPoints,
    fetchCompetitions,
    FALLBACK_HOUSES,
    FALLBACK_COMPETITIONS,
    getBaseUrl,
    getApiKey,
    runDiagnostics
};

