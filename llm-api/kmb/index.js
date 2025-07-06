const { createObjectCsvStringifier } = require('csv-writer');
const express = require('express');
const Redis = require('ioredis');

const router = express.Router();

const KmbService = require('./kmbService');

// Configuration Constants
const HOME_AREA_STOP_NAMES = [
    'KAM TAI COURT',
    'CHEVALIER GARDEN (',
    'CHEVALIER GARDEN BUS',
];
const WORK_AREA_STOP_NAMES = [
    'TSIM SHA TSUI BBI - HAIPHONG ROAD',
    'KOWLOON PARK DRIVE',
    'HANKOW ROAD BUS TERMINUS'
];

const redis = new Redis({
    host: 'redis'
});


// Initialize KmbService with redis client and target stop names
const kmbService = new KmbService(redis, HOME_AREA_STOP_NAMES, WORK_AREA_STOP_NAMES);

router.get('/stops/home', async (req, res) => {
    try {
        const parsedStops = await kmbService.getHomeAreaStops();

        if (parsedStops.length === 0) {
            return res.status(404).send('No KMB stops found for home area. Data might not be synced yet.');
        }

        res.json(parsedStops);
    } catch (error) {
        console.error('Error fetching KMB home stops from Redis:', error.message);
        res.status(500).send('Internal Server Error.');
    }
});

router.get('/stops/work', async (req, res) => {
    try {
        const parsedStops = await kmbService.getWorkAreaStops();

        if (parsedStops.length === 0) {
            return res.status(404).send('No KMB stops found for work area. Data might not be synced yet.');
        }

        res.json(parsedStops);
    } catch (error) {
        console.error('Error fetching KMB work stops from Redis:', error.message);
        res.status(500).send('Internal Server Error.');
    }
});


/**
 * Helper function to send CSV response.
 * @param {Array<Object>} etaRecords - The ETA data records to stringify to CSV.
 * @param {express.Response} res - The Express response object.
 * @param {string} filename - The desired filename for the CSV download.
 * @param {boolean} showAll - Whether to show records with no ETA.
 */
const sendEtaCsvResponse = (etaRecords, res, filename, showAll) => {
    let recordsToSend = etaRecords;

    if (!showAll) {
        recordsToSend = etaRecords.filter(record => record.eta && record.eta.trim() !== '');
    }

    if (recordsToSend.length === 0) {
        console.warn('No ETA records generated or all filtered out.');
        return res.status(404).send('No ETA data available based on your criteria.');
    }
    // First, process the ETA date strings into a more readable format
    const processedRecords = recordsToSend.map(record => {
        if (record.eta) {
            // Split the eta string by '|' to handle multiple ETAs
            const etas = record.eta.split('|').map(etaStr => {
                try {
                    // Create a Date object from the ISO string
                    const date = new Date(etaStr);
                    // Format to HH:MM in Hong Kong time (Asia/Hong_Kong)
                    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong' });
                } catch (e) {
                    console.warn(`Invalid date string encountered: ${etaStr}`);
                    return etaStr; // Return original if parsing fails
                }
            });
            return {
                ...record,
                eta: etas.join('|') // Join processed ETAs back with '|'
            };
        }
        return record;
    });
    // Sort the processed records based on the new criteria
    processedRecords.sort((a, b) => {
        const aHasDistance = a.distance_to_target !== undefined && a.distance_to_target !== null && a.distance_to_target !== '';
        const bHasDistance = b.distance_to_target !== undefined && b.distance_to_target !== null && b.distance_to_target !== '';

        const aHasEta = a.eta !== undefined && a.eta !== null && a.eta !== '';
        const bHasEta = b.eta !== undefined && b.eta !== null && b.eta !== '';
        // Rule 1: Prioritize records with distance_to_target
        if (aHasDistance && !bHasDistance) {
            return -1;
        }
        if (!aHasDistance && bHasDistance) {
            return 1;
        }

        // If both have distance, sort by distance
        if (aHasDistance && bHasDistance) {
            const distanceDiff = a.distance_to_target - b.distance_to_target;
            if (distanceDiff !== 0) {
                return distanceDiff;
            }
        }

        // Rule 2: Move records with no ETA to the end
        if (aHasEta && !bHasEta) {
            return -1;
        }
        if (!aHasEta && bHasEta) {
            return 1;
        }

        // Rule 3: For all other cases (including those with distance but equal, or neither having distance),
        // sort by stop_name_tc
        return a.stop_name_tc.localeCompare(b.stop_name_tc);
    });

    processedRecords.forEach(record => {
        if (!record.eta || record.eta.trim() === '') {
            record.eta = '沒有服務或到站時間'
        }
    });


    // console.log(processedRecords);
    const csvStringifier = createObjectCsvStringifier({
        header: [
            // { id: 'stop_id', title: 'Stop ID' },
            { id: 'stop_name_tc', title: 'Stop Name (TC)' },
            // { id: 'company', title: 'Company' },
            { id: 'route', title: 'Route' },
            { id: 'direction', title: 'Direction' },
            { id: 'service_type', title: 'Service Type' },
            { id: 'sequence', title: 'Sequence' },
            { id: 'destination_tc', title: 'Destination (TC)' },
            { id: 'eta_sequence', title: 'ETA Sequence' },
            { id: 'eta', title: 'ETA' },
            { id: 'remarks_tc', title: 'Remarks (TC)' },
            { id: 'intermediate_stops', title: 'Intermediate Stops' },
            { id: 'stops_to_target', title: 'Stops Until Target' },
            { id: 'distance_to_target', title: 'Distance To Target' }
            // { id: 'data_timestamp', title: 'Data Timestamp' }
        ]
    });

    const csvOutput = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(processedRecords);
    // res.header('Content-Type', 'text/csv');
    // res.attachment(filename);
    res.send(csvOutput);
}

/**
 * Retrieves ETA for bus routes for a specified area (home/work) and direction (inbound/outbound/both).
 */
router.get('/bus-etas/:area/:direction', async (req, res) => {
    try {
        const { area, direction } = req.params;
        const busStopQuery = req.query.destination_stop;
        const showAll = true; // Always show all records, filter in response if needed

        let directionCode;
        if (direction === 'inbound') {
            directionCode = 'I';
        } else if (direction === 'outbound') {
            directionCode = 'O';
        } else if (direction === 'both') {
            directionCode = 'both';
        } else {
            return res.status(400).send('Invalid direction specified. Use "inbound", "outbound", or "both".');
        }
        const filename = `${area}_area_bus_etas_${direction}.csv`;

        let records;
        if (area === 'home') {
            records = await kmbService.getHomeAreaBusEtas(directionCode, busStopQuery);
        } else { // area === 'work'
            records = await kmbService.getWorkAreaBusEtas(directionCode, busStopQuery);
        }

        sendEtaCsvResponse(records, res, filename, showAll);

    } catch (error) {
        console.error(`Error fetching KMB ETA for ${req.params.area} area (${req.params.direction}):`, error.message);
        res.status(500).send('Internal Server Error while fetching ETA.');
    }
});
/**
 * Endpoint to retrieve mapping of bus stops to routes and their directions in CSV format for a specific area.
 */
router.get('/stop-route-map/:area', async (req, res) => {
    try {
        const { area } = req.params;

        if (area !== 'home' && area !== 'work') {
            return res.status(400).send('Invalid area specified. Use "home" or "work".');
        }

        let stopRouteMap;
        if (area === 'home') {
            stopRouteMap = await kmbService.getIntermediateStopRouteMap();
        } else { // area === 'work'
            stopRouteMap = await kmbService.getWorkIntermediateStopRouteMap();
        }

        if (Object.keys(stopRouteMap).length === 0) {
            return res.status(404).send(`No stop route map data available for ${area} area.`);
        }

        // Prepare data for CSV stringifier
        const records = [];
        for (const stopName in stopRouteMap) {
            records.push({
                stop_name: stopName,
                routes: stopRouteMap[stopName].join(', ') // Join array of routes into a single string
            });
        }

        records.sort((a, b) => a.stop_name.localeCompare(b.stop_name));

        const csvStringifier = createObjectCsvStringifier({
            header: [
                { id: 'stop_name', title: 'Stop Name' },
                { id: 'routes', title: 'Routes (Route/Direction)' }
            ]
        });

        const csvOutput = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);
        // const filename = `${area}_stop_route_map.csv`;
        // res.header('Content-Type', 'text/csv');
        // res.attachment(filename);
        res.send(csvOutput);

    } catch (error) {
        console.error(`Error fetching stop route map for ${req.params.area}:`, error.message);
        res.status(500).send('Internal Server Error while fetching stop route map.');
    }
});

module.exports = router;
