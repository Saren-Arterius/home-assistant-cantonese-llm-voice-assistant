
const express = require('express');
const axios = require('axios');
const { createObjectCsvStringifier } = require('csv-writer');
const fs = require('fs'); // Import fs to read the JSON file
const path = require('path'); // Import path to resolve file paths
const os = require('os'); // This import is not used in the provided code, but kept for consistency
const app = express();
// Configuration Constants
const KMB_STOP_API_URL = 'https://data.etabus.gov.hk/v1/transport/kmb/stop';
const KMB_ETA_API_BASE_URL = 'https://data.etabus.gov.hk/v1/transport/kmb/stop-eta';
const KMB_ROUTE_STOP_API_BASE_URL = 'https://data.etabus.gov.hk/v1/transport/kmb/route-stop';
// Redis Keys
const REDIS_HOME_HASH_KEY = 'kmb_stops_home_area';
const REDIS_WORK_HASH_KEY = 'kmb_stops_work_area';
const REDIS_ALL_STOPS_KEY = 'kmb_all_stops';
const REDIS_LAST_FETCH_TIME_KEY = 'kmb_stops_last_fetch_time7';
const REDIS_HOME_AREA_ROUTES_KEY = 'kmb_home_area_routes';
const REDIS_WORK_AREA_ROUTES_KEY = 'kmb_work_area_routes';
const REDIS_ROUTE_STOP_KEY = 'kmb_route_stop';
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;
class KmbService {
    constructor(redisClient, homeStopNames, workStopNames) {
        this.redis = redisClient;
        this.HOME_STOP_NAMES = homeStopNames.map(name => name.toUpperCase());
        this.WORK_STOP_NAMES = workStopNames.map(name => name.toUpperCase());
        this.TARGET_STOP_NAMES = [...this.HOME_STOP_NAMES, ...this.WORK_STOP_NAMES];
        this.KAM_TAI_COURT_EN = this.HOME_STOP_NAMES.length > 0 ? this.HOME_STOP_NAMES[0] : '';
        this.CHEVALIER_GARDEN_BUS_EN = this.HOME_STOP_NAMES.length > 2 ? this.HOME_STOP_NAMES[2] : '';
        // Fetch data on startup
        this.fetchAndSaveKmbStops();
        // Schedule daily data refresh
        setInterval(() => this.fetchAndSaveKmbStops(), TWENTY_FOUR_HOURS_IN_MS);
    }
    /**
     * Fetches KMB stop data from the external API, filters it based on target names,
     * and saves the matching stops to Redis hashes for home and work areas.
     * Additionally, saves a full copy of all stops to another Redis key.
     * This function only runs if the last fetch was more than 24 hours ago.
     */
    async fetchAndSaveKmbStops() {
        console.log('Checking KMB stop data refresh condition...');
        try {
            const lastFetchTimeStr = await this.redis.get(REDIS_LAST_FETCH_TIME_KEY);
            const lastFetchTime = lastFetchTimeStr ? parseInt(lastFetchTimeStr, 10) : 0;
            const currentTime = Date.now();
            if (currentTime - lastFetchTime < TWENTY_FOUR_HOURS_IN_MS) {
                console.log('KMB stop data was fetched less than 24 hours ago. Skipping refresh.');
                return;
            }
            console.log('Starting KMB stop data refresh...');
            const response = await axios.get(KMB_STOP_API_URL);
            const allStops = response.data.data;
            if (!Array.isArray(allStops)) {
                console.warn('API returned unexpected data format. Aborting save.');
                return;
            }
            const pipeline = this.redis.pipeline();
            // Clear existing data
            pipeline.del(REDIS_HOME_HASH_KEY);
            pipeline.del(REDIS_WORK_HASH_KEY);
            pipeline.del(REDIS_ALL_STOPS_KEY);
            pipeline.del(REDIS_HOME_AREA_ROUTES_KEY);
            pipeline.del(REDIS_WORK_AREA_ROUTES_KEY);
            pipeline.del(REDIS_ROUTE_STOP_KEY);
            const stopIdToNameMap = new Map();
            const homeAreaStopIds = [];
            const workAreaStopIds = [];
            let homeMatchedCount = 0;
            let workMatchedCount = 0;
            for (const stop of allStops) {
                if (stop?.stop && stop.name_en) {
                    const stopNameUpper = stop.name_en.toUpperCase();
                    const isHomeMatch = this.HOME_STOP_NAMES.some(target => stopNameUpper.includes(target));
                    const isWorkMatch = this.WORK_STOP_NAMES.some(target => stopNameUpper.includes(target));
                    stopIdToNameMap.set(stop.stop, stop.name_tc);
                    pipeline.hset(REDIS_ALL_STOPS_KEY, stop.stop, JSON.stringify(stop));
                    if (isHomeMatch) {
                        pipeline.hset(REDIS_HOME_HASH_KEY, stop.stop, JSON.stringify(stop));
                        homeAreaStopIds.push(stop.stop);
                        homeMatchedCount++;
                    }
                    if (isWorkMatch) {
                        pipeline.hset(REDIS_WORK_HASH_KEY, stop.stop, JSON.stringify(stop));
                        workAreaStopIds.push(stop.stop);
                        workMatchedCount++;
                    }
                }
            }
            // Helper to get routes for a given set of stop IDs
            const _getRoutesForStops = async (stopIds) => {
                const uniqueRoutes = new Set();
                for (const stopId of stopIds) {
                    const etaUrl = `${KMB_ETA_API_BASE_URL}/${stopId}`;
                    try {
                        const etaResponse = await axios.get(etaUrl);
                        if (etaResponse.data && Array.isArray(etaResponse.data.data)) {
                            etaResponse.data.data.forEach(eta => {
                                if (eta.route && eta.dir && eta.service_type) {
                                    const directionName = eta.dir === 'I' ? 'inbound' : (eta.dir === 'O' ? 'outbound' : eta.dir);
                                    uniqueRoutes.add(`${eta.route}-${directionName}-${eta.service_type}`);
                                }
                            });
                        }
                    } catch (etaError) {
                        console.error(`Error fetching ETA for stop ${stopId} to identify routes:`, etaError.message);
                    }
                }
                return Array.from(uniqueRoutes).map(routeInfo => {
                    const [route, dir, serviceType] = routeInfo.split('-');
                    return { route, dir, serviceType };
                });
            };
            const homeRoutesToStore = await _getRoutesForStops(homeAreaStopIds);
            pipeline.set(REDIS_HOME_AREA_ROUTES_KEY, JSON.stringify(homeRoutesToStore));
            console.log(`Identified and will save ${homeRoutesToStore.length} unique routes from home area stops.`);
            const workRoutesToStore = await _getRoutesForStops(workAreaStopIds);
            pipeline.set(REDIS_WORK_AREA_ROUTES_KEY, JSON.stringify(workRoutesToStore));
            console.log(`Identified and will save ${workRoutesToStore.length} unique routes from work area stops.`);
            console.log('Fetching and saving KMB route-stop data...');
            const allUniqueRoutes = [...homeRoutesToStore, ...workRoutesToStore];
            const processedRoutes = new Set(); // To avoid processing the same route-dir-service_type combination twice
            let routeStopCount = 0;
            for (const routeObj of allUniqueRoutes) {
                const { route, dir, serviceType } = routeObj;
                const fieldName = `${route}_${dir}_${serviceType}`;
                if (processedRoutes.has(fieldName)) continue;
                processedRoutes.add(fieldName);
                const routeStopUrl = `${KMB_ROUTE_STOP_API_BASE_URL}/${route}/${dir}/${serviceType}`;
                try {
                    const routeStopResponse = await axios.get(routeStopUrl);
                    if (routeStopResponse.data && Array.isArray(routeStopResponse.data.data)) {
                        const stopNames = routeStopResponse.data.data
                            .map(routeStop => stopIdToNameMap.get(routeStop.stop) || routeStop.stop);
                        pipeline.hset(REDIS_ROUTE_STOP_KEY, fieldName, stopNames.join(','));
                        routeStopCount++;
                    } else {
                        console.warn(`No data found for route-stop: ${fieldName}`);
                    }
                } catch (rsError) {
                    console.error(`Error fetching route-stop data for ${fieldName}:`, rsError.message);
                }
            }
            pipeline.set(REDIS_LAST_FETCH_TIME_KEY, currentTime.toString());
            await pipeline.exec();
            console.log(`Successfully saved ${homeMatchedCount} KMB home area stops to Redis hash: ${REDIS_HOME_HASH_KEY}`);
            console.log(`Successfully saved ${workMatchedCount} KMB work area stops to Redis hash: ${REDIS_WORK_HASH_KEY}`);
            console.log(`Saved a full copy of ${allStops.length} KMB stops to Redis hash: ${REDIS_ALL_STOPS_KEY}`);
            console.log(`Successfully fetched and saved route-stop data for ${routeStopCount} unique routes.`);
            console.log(`Updated last fetch timestamp to ${new Date(currentTime).toISOString()}`);
        } catch (error) {
            console.error('Error refreshing KMB stop or route data:', error.message);
            if (error.response) {
                console.error(`API Response Error: Status ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                console.error('No response received from API.');
            }
        }
    }
    /**
     * Retrieves filtered KMB stops from Redis for the home area.
     * @returns {Array} An array of parsed stop objects.
     */
    async getHomeAreaStops() {
        const homeAreaStopsMap = await this.redis.hgetall(REDIS_HOME_HASH_KEY);
        return Object.values(homeAreaStopsMap).map(JSON.parse);
    }
    /**
     * Retrieves filtered KMB stops from Redis for the work area.
     * @returns {Array} An array of parsed stop objects.
     */
    async getWorkAreaStops() {
        const workAreaStopsMap = await this.redis.hgetall(REDIS_WORK_HASH_KEY);
        return Object.values(workAreaStopsMap).map(JSON.parse);
    }
    /**
     * Helper to create a standardized empty record for CSV.
     * @param {object} stopInfo - The stop information.
     * @param {string} stopId - The stop ID.
     * @param {string} remarks - Remarks for the record.
     * @returns {object} An empty ETA record.
     */
    _createEmptyEtaRecord(stopInfo, stopId, remarks) {
        return {
            stop_id: stopInfo.stop || stopId,
            stop_name_tc: stopInfo.name_tc || '',
            company: '',
            route: '',
            direction: '',
            service_type: '',
            sequence: '',
            destination_tc: '',
            eta_sequence: '',
            eta: '',
            remarks_tc: remarks,
            data_timestamp: '',
            intermediate_stops: '' // Add this field for consistency
        };
    }
    /**
     * Generic internal method to retrieve ETA for a given area.
     * @param {string} areaRedisKey - The Redis key for the area's stops hash.
     * @param {string} direction - The desired direction ('O' for Outbound, 'I' for Inbound, or 'both').
     * @param {string|null} distanceToBusStopQuery - An string containing a partial intermediate stop name for distance calculation.
     * @param {Function|null} customFilter - A function to apply custom filtering logic to ETAs.
     * @returns {Array} An array of records suitable for CSV creation.
     */
    async _getBusEtas(areaRedisKey, direction, distanceToBusStopQuery, customFilter = null) {
        const areaStopsMap = await this.redis.hgetall(areaRedisKey);
        const allRouteStops = await this.redis.hgetall(REDIS_ROUTE_STOP_KEY);
        if (Object.keys(areaStopsMap).length === 0) {
            console.warn(`No stops found in Redis for key ${areaRedisKey}, cannot fetch ETA.`);
            return [];
        }
        const nearbyStopIds = Object.keys(areaStopsMap);
        const etaResults = await Promise.allSettled(
            nearbyStopIds.map(async stopId => {
                const etaUrl = `${KMB_ETA_API_BASE_URL}/${stopId}`;
                const response = await axios.get(etaUrl);
                return { stopId, data: response.data.data };
            })
        );
        const allParsedEtas = new Map();
        let customFilterData = {};
        // Pre-process for custom filters if needed
        if (customFilter) {
            customFilterData = customFilter.preProcess(etaResults, areaStopsMap, direction);
        }
        for (const result of etaResults) {
            if (result.status === 'fulfilled') {
                const { stopId, data } = result.value;
                if (data && data.length > 0) {
                    allParsedEtas.set(stopId, data);
                }
            } else {
                const stopId = result.reason?.config?.url.split('/').pop();
                if (stopId) {
                    console.error(`Error fetching ETA for stop ${stopId}:`, result.reason.message);
                    allParsedEtas.set(stopId, { error: result.reason.message });
                }
            }
        }
        const records = [];
        const mergedEtaMap = new Map();
        for (const stopId of nearbyStopIds) {
            const stopInfoString = areaStopsMap[stopId];
            const stopInfo = stopInfoString ? JSON.parse(stopInfoString) : {};
            const etasFromApi = allParsedEtas.get(stopId);
            if (!etasFromApi || etasFromApi.error) {
                continue;
            }
            // Filter ETAs by the specified direction, or include all if 'both' is specified.
            let filteredEtas = direction === 'both'
                ? etasFromApi
                : etasFromApi.filter(eta => eta.dir === direction);
            if (customFilter) {
                // The custom filter's `apply` method handles the filtered ETAs.
                filteredEtas = customFilter.apply(filteredEtas, stopInfo, customFilterData);
            }
            for (const eta of filteredEtas) {
                const directionName = eta.dir === 'I' ? 'inbound' : (eta.dir === 'O' ? 'outbound' : eta.dir);
                const routeStopKey = `${eta.route}_${directionName}_${eta.service_type}`;
                const intermediateStopsString = allRouteStops[routeStopKey] || '';
                const stopNamesInOrder = intermediateStopsString.split(',').map(s => s.trim());
                const currentStopIndex = stopNamesInOrder.findIndex(name => name.includes(stopInfo.name_tc));
                let intermediateStopsAfterCurrent = [];
                if (currentStopIndex !== -1) {
                    intermediateStopsAfterCurrent = stopNamesInOrder.slice(currentStopIndex + 1);
                }
                const intermediateStopsFiltered = intermediateStopsAfterCurrent
                    .map(s => s.replace(/\s*\(.*\)\s*$/, '').trim())
                    .filter(Boolean)
                    .join(',');
                let stopsUntilTarget = '';
                let distance = '';
                if (distanceToBusStopQuery) {
                    const targetQueryCleaned = distanceToBusStopQuery.replace(/\s*\(.*\)\s*$/, '').trim();
                    if (currentStopIndex !== -1 && stopNamesInOrder[currentStopIndex].replace(/\s*\(.*\)\s*$/, '').trim().includes(targetQueryCleaned)) {
                        distance = '0';
                        stopsUntilTarget = stopNamesInOrder[currentStopIndex].replace(/\s*\(.*\)\s*$/, '').trim();
                    } else if (currentStopIndex !== -1) {
                        let count = 0;
                        let targetFound = false;
                        let targetStopName = '';
                        for (let i = currentStopIndex + 1; i < stopNamesInOrder.length; i++) {
                            const stop = stopNamesInOrder[i];
                            const cleanedStop = stop.replace(/\s*\(.*\)\s*$/, '').trim();
                            count++;
                            if (cleanedStop.includes(targetQueryCleaned)) {
                                targetFound = true;
                                targetStopName = cleanedStop;
                                break;
                            }
                        }
                        if (targetFound) {
                            distance = count.toString();
                            stopsUntilTarget = targetStopName;
                        }
                    }
                }
                // Aggregate ETAs for the same route, direction, service type, and destination at a single stop.
                // This handles cases where KMB API provides multiple ETA entries for the same bus service (e.g., next 3 arrival times).
                const mergeKey = `${stopId}-${eta.route}-${eta.dir}-${eta.service_type}-${eta.dest_tc}`;
                if (!mergedEtaMap.has(mergeKey)) {
                    const displayName = stopInfo.name_tc.replace(/\s*\(.*\)\s*$/, '');
                    mergedEtaMap.set(mergeKey, {
                        stop_id: stopInfo.stop || stopId,
                        stop_name_tc: displayName || '',
                        company: eta.co || '',
                        route: eta.route || '',
                        direction: eta.dir || '',
                        service_type: eta.service_type || '',
                        sequence: eta.seq || '',
                        destination_tc: eta.dest_tc || '',
                        eta_sequence: [],
                        eta: [],
                        remarks_tc: [],
                        data_timestamp: eta.data_timestamp || '',
                        intermediate_stops: intermediateStopsFiltered,
                        stops_to_target: stopsUntilTarget,
                        distance_to_target: distance
                    });
                }
                const mergedRecord = mergedEtaMap.get(mergeKey);
                mergedRecord.eta_sequence.push(eta.eta_seq || '');
                mergedRecord.eta.push(eta.eta || '');
                mergedRecord.remarks_tc.push(eta.rmk_tc || '');
            }
        }
        mergedEtaMap.forEach(record => {
            records.push({
                ...record,
                eta_sequence: record.eta_sequence.join('|'),
                eta: record.eta.join('|'),
                remarks_tc: record.remarks_tc.filter(Boolean).join('|') // Filter out empty remarks before joining
            });
        });
        return records;
    }
    /**
     * Retrieves ETA for all bus routes at nearby KMB stations (HOME) and formats them for CSV.
     * @param {string} [direction='O'] The desired direction ('O' for Outbound, 'I' for Inbound, or 'both').
     * @param {string} [distanceToBusStopQuery=null] A string containing a partial intermediate stop name for distance calculation.
     * @returns {Array} An array of records suitable for CSV creation.
     */
    async getHomeAreaBusEtas(direction = 'O', distanceToBusStopQuery = null) {
        const homeSpecificFilter = {
            preProcess: (etaResults, areaStopsMap, dir) => {
                // This set will store unique route-direction combinations (e.g., '269D-O').
                const kamTaiCourtRoutes = new Set();
                for (const result of etaResults) {
                    if (result.status === 'fulfilled') {
                        const { stopId, data } = result.value;
                        const stopInfoString = areaStopsMap[stopId];
                        const stopInfo = stopInfoString ? JSON.parse(stopInfoString) : {};
                        // Check if this stop is 'KAM TAI COURT'.
                        if (data && stopInfo.name_en?.toUpperCase().includes(this.KAM_TAI_COURT_EN)) {
                            // Filter ETAs based on the requested direction ('O', 'I', or 'both').
                            const relevantEtas = data.filter(eta => (dir === 'both' || eta.dir === dir) && eta.route);
                            relevantEtas.forEach(eta => {
                                // Store the route-direction pair to identify it uniquely.
                                kamTaiCourtRoutes.add(`${eta.route}-${eta.dir}`);
                            });
                        }
                    }
                }
                return { kamTaiCourtRoutes };
            },
            apply: (etas, stopInfo, filterData) => {
                // Check if this stop is 'CHEVALIER GARDEN BUS TERMINUS'.
                const isChevalierGardenBus = stopInfo.name_en?.toUpperCase().includes(this.CHEVALIER_GARDEN_BUS_EN);
                if (isChevalierGardenBus) {
                    // Filter out routes from Chevalier Garden that are also present at Kam Tai Court
                    // for the same direction to avoid seeing the same bus service at two nearby stops.
                    return etas.filter(eta => !filterData.kamTaiCourtRoutes.has(`${eta.route}-${eta.dir}`));
                }
                return etas;
            }
        };
        return this._getBusEtas(REDIS_HOME_HASH_KEY, direction, distanceToBusStopQuery, homeSpecificFilter);
    }
    /**
     * Retrieves ETA for all bus routes at nearby KMB stations (WORK) and formats them for CSV.
     * @param {string} [direction='I'] The desired direction ('O' for Outbound, 'I' for Inbound, or 'both').
     * @param {string} [distanceToBusStopQuery=null] A string containing a partial intermediate stop name for distance calculation.
     * @returns {Array} An array of records suitable for CSV creation.
     */
    async getWorkAreaBusEtas(direction = 'I', distanceToBusStopQuery = null) {
        // No special filtering logic for the work area currently, so we pass null for the custom filter.
        return this._getBusEtas(REDIS_WORK_HASH_KEY, direction, distanceToBusStopQuery, null);
    }
    /**
     * Generic method to retrieve intermediate stop route map for a given area and direction.
     * @param {string} areaRedisKey - The Redis key for the area's stops hash.
     * @param {string} direction - The direction to filter by ('outbound', 'inbound', or 'both').
     * @returns {object} Map of intermediate stops to routes.
     */
    async _getIntermediateStopRouteMap(areaRedisKey, direction) {
        const areaStopsMap = await this.redis.hgetall(areaRedisKey);
        const allRouteStops = await this.redis.hgetall(REDIS_ROUTE_STOP_KEY);
        const intermediateStopRouteMap = {};
        const formatRouteKey = (route, serviceType) => `${route}/${serviceType}`;
        const areaStopNamesTc = new Set(
            Object.values(areaStopsMap)
                .map(JSON.parse)
                .map(stopInfo => stopInfo.name_tc?.trim())
                .filter(Boolean)
        );
        const areaBusRoutes = new Set();
        const dirShort = direction === 'inbound' ? 'I' : 'O';
        for (const routeField in allRouteStops) {
            const parts = routeField.split('_');
            if (parts.length < 3) continue;
            const [route, dir, ...serviceTypeParts] = parts;
            const serviceType = serviceTypeParts.join('_');
            const isDirectionMatch = direction === 'both' || dir === direction || dir === dirShort;
            if (!isDirectionMatch) {
                continue;
            }
            const routeStopNames = allRouteStops[routeField].split(',');
            const hasAreaStop = routeStopNames.some(name => areaStopNamesTc.has(name.trim()));
            if (hasAreaStop) {
                areaBusRoutes.add(formatRouteKey(route, serviceType));
            }
        }
        for (const routeField in allRouteStops) {
            const parts = routeField.split('_');
            if (parts.length < 3) continue;
            const [route, dir, ...serviceTypeParts] = parts;
            const serviceType = serviceTypeParts.join('_');
            const formattedRouteKey = formatRouteKey(route, serviceType);
            const isDirectionMatch = direction === 'both' || dir === direction || dir === dirShort;
            if (!areaBusRoutes.has(formattedRouteKey) || !isDirectionMatch) {
                continue;
            }
            const allStopsForRoute = allRouteStops[routeField];
            if (!allStopsForRoute) continue;
            const stopNames = allStopsForRoute.split(',');
            for (const stopName of stopNames) {
                const cleanedStopName = stopName.trim();
                const displayName = cleanedStopName.replace(/\s*\(.*\)\s*$/, '');
                if (!displayName) continue;
                if (!intermediateStopRouteMap[displayName]) {
                    intermediateStopRouteMap[displayName] = new Set();
                }
                intermediateStopRouteMap[displayName].add(formattedRouteKey);
            }
        }
        for (const stopName in intermediateStopRouteMap) {
            intermediateStopRouteMap[stopName] = Array.from(intermediateStopRouteMap[stopName]);
        }
        return intermediateStopRouteMap;
    }
    /**
     * Retrieves mapping of intermediate bus stops to routes for home area routes.
     * @param {string} [direction='outbound'] - The direction to filter by ('outbound', 'inbound', or 'both').
     * @returns {object} Map of intermediate stops to routes for home area.
     */
    async getIntermediateStopRouteMap(direction = 'both') {
        return this._getIntermediateStopRouteMap(REDIS_HOME_HASH_KEY, direction);
    }
    /**
     * Retrieves mapping of intermediate bus stops to routes for work area routes.
     * @param {string} [direction='inbound'] - The direction to filter by ('outbound', 'inbound', or 'both').
     * @returns {object} Map of intermediate stops to routes for work area.
     */
    async getWorkIntermediateStopRouteMap(direction = 'both') {
        return this._getIntermediateStopRouteMap(REDIS_WORK_HASH_KEY, direction);
    }
}
module.exports = KmbService;