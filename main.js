// @ts-check

/**
 * @typedef {import('@peertube/peertube-types').RegisterServerOptions} RegisterServerOptions
 * @typedef {import('@peertube/peertube-types').PeerTubeHelpers} PeerTubeHelpers
 * @typedef {import('@peertube/peertube-types').MVideoFormattableDetails} MVideoFormattableDetails
 * @typedef {import('@peertube/peertube-types').MVideoFullLight} MVideoFullLight
 * @typedef {import('@peertube/peertube-types').ServerHookName} ServerHookName
 * @typedef {import('@peertube/peertube-types').PluginStorageManager} PluginStorageManager
 * @typedef {import('@peertube/peertube-types').PluginSettingsManager} PluginSettingsManager
 * @typedef {import('@peertube/peertube-types').SettingEntries} SettingEntries
 */

const VIDEO_FIELD_SUBSCRIBER_ONLY = 'subscriber-only';
const VIDEO_FIELD_DENY_DOWNLOAD = 'deny-download';
const PLUGIN_BLOCKED_FLAG = 'subscriber-only-blocked';
const VIDEO_FLAGS_STORAGE_PREFIX = 'video-flags:';
const SETTING_REMOVE_SUBSCRIBE_BUTTON = 'remove-subscribe-button';
const SETTING_DEFAULT_SUBSCRIBER_ONLY = 'default-subscriber-only';
const SETTING_DEFAULT_DENY_DOWNLOAD = 'default-deny-download';
const SETTING_GLOBAL_SUBSCRIBER_ONLY = 'global-subscriber-only';
const SETTING_GLOBAL_DENY_DOWNLOAD = 'global-deny-download';

/**
 * @param {any} value
 * @returns {boolean | undefined}
 */
function normalizeFlag(value) {
	if (value === undefined || value === null) return undefined;
	if (value === 'on' || value === 1 || value === '1') return true;
	if (value === 'off' || value === 0 || value === '0') return false;
	if (value === true || value === 'true') return true;
	if (value === false || value === 'false') return false;

	return undefined;
}

/**
 * @param {any} body
 * @returns {{ subscriberOnly?: boolean, denyDownload?: boolean } | undefined}
 */
function getFlagsFromBody(body) {
	if (!body || typeof body !== 'object') return undefined;

	let pluginData = body.pluginData;
	if (!pluginData || typeof pluginData !== 'object') return undefined;

	const subscriberRaw = pluginData[VIDEO_FIELD_SUBSCRIBER_ONLY];
	const denyRaw = pluginData[VIDEO_FIELD_DENY_DOWNLOAD];

	const subscriberOnly = normalizeFlag(subscriberRaw);
	const denyDownload = normalizeFlag(denyRaw);

	return {
		subscriberOnly: subscriberOnly ?? false,
		denyDownload: denyDownload ?? false,
	};
}

/**
 * @param {PluginStorageManager} storageManager
 * @param {any} video
 * @returns {Promise<{ subscriberOnly?: boolean, denyDownload?: boolean } | undefined>}
 */
async function readStoredFlags(storageManager, video) {
	const storageKey = `${VIDEO_FLAGS_STORAGE_PREFIX}${video.uuid}`;

	/** @type {any} */
	let raw = await storageManager.getData(storageKey);

	if (!raw) return undefined;

	if (typeof raw === 'string') {
		raw = JSON.parse(raw);
	}

	if (!raw || typeof raw !== 'object') return undefined;

	return {
		subscriberOnly: normalizeFlag(raw.subscriberOnly),
		denyDownload: normalizeFlag(raw.denyDownload),
	};
}

/**
 * @param {PluginStorageManager} storageManager
 * @param {any} video
 * @param {{ subscriberOnly?: boolean, denyDownload?: boolean }} flags
 * @returns {Promise<void>}
 */
async function storeFlags(storageManager, video, flags) {
	const storageKey = `${VIDEO_FLAGS_STORAGE_PREFIX}${video.uuid}`;

	storageManager.storeData(storageKey, {
		subscriberOnly: flags.subscriberOnly,
		denyDownload: flags.denyDownload,
	});
}

/**
 * @param {any} video
 * @returns {number | undefined}
 */
function getChannelId(video) {
	return video?.channel?.id ?? video?.channelId ?? video?.videoChannel?.id;
}

/**
 * @param {any} video
 * @returns {number | undefined}
 */
function getVideoId(video) {
	return video?.id;
}

/**
 * @param {PeerTubeHelpers} peertubeHelpers
 * @param {number} userId
 * @returns {Promise<Set<number>>}
 */
async function getOwnedChannelIds(peertubeHelpers, userId) {
	const [rows] = await peertubeHelpers.database.query(
		`SELECT vc.id
     FROM "videoChannel" vc
     JOIN account a ON vc."accountId" = a.id
     WHERE a."userId" = ${Number(userId)}`
	);

	return new Set(
		(rows || []).map((/** @type {{ id: number }} */ row) => row.id)
	);
}

/**
 * @param {PeerTubeHelpers} peertubeHelpers
 * @param {number} userId
 * @returns {Promise<Set<number>>}
 */
async function getFollowedChannelIds(peertubeHelpers, userId) {
	const [rows] = await peertubeHelpers.database.query(
		`SELECT vc.id
     FROM "actorFollow" af
	JOIN "actor" follower ON follower.id = af."actorId"
	JOIN account a ON a.id = follower."accountId"
	JOIN "user" u ON u.id = a."userId"
	JOIN "actor" target ON target.id = af."targetActorId"
	JOIN "videoChannel" vc ON vc.id = target."videoChannelId"
     WHERE u.id = ${Number(userId)}
       AND target."videoChannelId" IS NOT NULL`
	);

	return new Set(
		(rows || []).map((/** @type {{ id: number }} */ row) => row.id)
	);
}

/**
 * @param {PeerTubeHelpers} peertubeHelpers
 * @param {number} userId
 * @param {number} videoId
 * @returns {Promise<boolean>}
 */
async function isVideoOwner(peertubeHelpers, userId, videoId) {
	const [rows] = await peertubeHelpers.database.query(
		`SELECT COUNT(*) as count
     FROM video v
     JOIN "videoChannel" vc ON v."channelId" = vc.id
     JOIN account a ON vc."accountId" = a.id
     WHERE v.id = ${Number(videoId)} AND a."userId" = ${Number(userId)}`
	);

	return Number(rows?.[0]?.count || 0) > 0;
}

/**
 * @param {PeerTubeHelpers} peertubeHelpers
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
async function isRootAdmin(peertubeHelpers, userId) {
	try {
		const user = await peertubeHelpers.user.loadById(userId);
		return user?.role === 0;
	} catch {
		return false;
	}
}

/**
 * @param {PeerTubeHelpers} peertubeHelpers
 * @param {number | undefined} userId
 * @param {any} video
 * @returns {Promise<boolean>}
 */
async function canAccessVideo(
	peertubeHelpers,
	userId,
	video,
	globalSubscriberOnly
) {
	const subscriberOnly = globalSubscriberOnly
		? true
		: Boolean(video.pluginData?.[VIDEO_FIELD_SUBSCRIBER_ONLY]);

	if (!subscriberOnly) return true;
	if (!userId) return false;

	if (await isRootAdmin(peertubeHelpers, userId)) return true;

	const videoId = getVideoId(video);
	const channelId = getChannelId(video);

	if (!videoId || !channelId) return false;

	if (await isVideoOwner(peertubeHelpers, userId, videoId)) return true;

	const followedChannelIds = await getFollowedChannelIds(
		peertubeHelpers,
		userId
	);

	return followedChannelIds.has(channelId);
}

/**
 * @param {any} video
 * @returns {any}
 */
function markVideoRestricted(video) {
	video.downloadEnabled = false;
	video.pluginData = {
		...(video.pluginData || {}),
		[VIDEO_FIELD_SUBSCRIBER_ONLY]: true,
		[PLUGIN_BLOCKED_FLAG]: true,
	};

	if (Array.isArray(video.VideoFiles)) {
		video.VideoFiles = [];
	}

	if (Array.isArray(video.VideoStreamingPlaylists)) {
		video.VideoStreamingPlaylists = [];
	}

	if (Array.isArray(video.files)) {
		video.files = [];
	}

	if (Array.isArray(video.streamingPlaylists)) {
		video.streamingPlaylists = [];
	}

	return video;
}

/**
 * @param {RegisterServerOptions} options
 */
async function register({
	registerHook,
	registerSetting,
	settingsManager,
	peertubeHelpers,
	storageManager,
}) {
	const { logger } = peertubeHelpers;
	let globalSubscriberOnly = false;
	let globalDenyDownload = false;

	/**
	 * @param {SettingEntries} settings
	 */
	const applySettings = (settings) => {
		globalSubscriberOnly = settings[SETTING_GLOBAL_SUBSCRIBER_ONLY] === true;
		globalDenyDownload = settings[SETTING_GLOBAL_DENY_DOWNLOAD] === true;
	};

	registerSetting({
		name: SETTING_REMOVE_SUBSCRIBE_BUTTON,
		label: 'Remove subscribe button',
		type: 'input-checkbox',
		private: false,
		default: false,
		descriptionHTML: 'Remove the subscribe button on video and channel pages.',
	});

	registerSetting({
		name: SETTING_DEFAULT_SUBSCRIBER_ONLY,
		label: 'Default: Subscribers only',
		type: 'input-checkbox',
		private: false,
		default: false,
		descriptionHTML:
			'Default value for "Subscribers only" on video upload/creation.',
	});

	registerSetting({
		name: SETTING_DEFAULT_DENY_DOWNLOAD,
		label: 'Default: Deny downloads',
		type: 'input-checkbox',
		private: false,
		default: false,
		descriptionHTML:
			'Default value for "Deny downloads" on video upload/creation.',
	});

	registerSetting({
		name: SETTING_GLOBAL_SUBSCRIBER_ONLY,
		label: 'Global: Subscribers only',
		type: 'input-checkbox',
		private: false,
		default: false,
		descriptionHTML:
			'Force all videos to be subscribers-only (overrides per-video setting).',
	});

	registerSetting({
		name: SETTING_GLOBAL_DENY_DOWNLOAD,
		label: 'Global: Deny downloads',
		type: 'input-checkbox',
		private: false,
		default: false,
		descriptionHTML:
			'Force downloads to be disabled for all videos (overrides per-video setting).',
	});

	settingsManager.onSettingsChange(async (settings) => applySettings(settings));
	applySettings(
		await settingsManager.getSettings([
			SETTING_GLOBAL_SUBSCRIBER_ONLY,
			SETTING_GLOBAL_DENY_DOWNLOAD,
		])
	);

	/**
	 * @param {{ data?: any[], total?: number }} result
	 * @param {{ user?: { id?: number } }} params
	 */
	const filterListResult = async (result, params) => {
		if (!result?.data || !Array.isArray(result.data)) return result;

		const userId = params?.user?.id;

		if (userId && (await isRootAdmin(peertubeHelpers, userId))) {
			return result;
		}

		if (!userId) {
			const filtered = [];

			for (const video of result.data) {
				const storedFlags = await readStoredFlags(storageManager, video);
				const subscriberOnly = globalSubscriberOnly
					? true
					: storedFlags?.subscriberOnly;

				if (!subscriberOnly) {
					filtered.push(video);
				}
			}

			result.data = filtered;
			result.total = result.data.length;
			return result;
		}

		let ownedChannelIds = new Set();
		let followedChannelIds = new Set();

		try {
			[ownedChannelIds, followedChannelIds] = await Promise.all([
				getOwnedChannelIds(peertubeHelpers, userId),
				getFollowedChannelIds(peertubeHelpers, userId),
			]);
		} catch (err) {
			logger.error('Failed to load channel access lists for user', {
				err,
				userId,
			});
			return result;
		}

		const filtered = [];

		for (const video of result.data) {
			const storedFlags = await readStoredFlags(storageManager, video);
			const subscriberOnly = globalSubscriberOnly
				? true
				: storedFlags?.subscriberOnly;

			if (!subscriberOnly) {
				filtered.push(video);
				continue;
			}

			const channelId = getChannelId(video);
			if (!channelId) continue;

			if (ownedChannelIds.has(channelId) || followedChannelIds.has(channelId)) {
				filtered.push(video);
			}
		}

		result.data = filtered;
		result.total = result.data.length;

		return result;
	};

	/**
	 * @param {{ allowed?: boolean }} result
	 * @param {{ user?: { id?: number }, video?: any }} params
	 */
	const denyDownload = async (result, params) => {
		if (!result?.allowed) return result;

		const userId = params?.user?.id;
		const video = params?.video;

		if (!video) return result;

		const storedFlags = await readStoredFlags(storageManager, video);
		if (globalDenyDownload || storedFlags?.denyDownload) {
			return {
				allowed: false,
				errorMessage: 'Downloads are disabled for this video.',
			};
		}

		try {
			if (
				await canAccessVideo(
					peertubeHelpers,
					userId,
					video,
					globalSubscriberOnly
				)
			) {
				return result;
			}
		} catch (err) {
			logger.error('Failed to check download access', {
				err,
				userId,
				videoId: video?.id,
			});
		}

		return {
			allowed: false,
			errorMessage: 'This video is restricted to channel subscribers.',
		};
	};

	/** @type {ServerHookName[]} */
	const listHooks = [
		'filter:api.videos.list.result',
		'filter:api.video-channels.videos.list.result',
		'filter:api.accounts.videos.list.result',
		'filter:api.search.videos.local.list.result',
		'filter:api.search.videos.index.list.result',
		'filter:api.video-playlist.videos.list.result',
		'filter:api.overviews.videos.list.result',
		'filter:api.user.me.subscription-videos.list.result',
	];

	for (const target of listHooks) {
		registerHook({
			target,
			handler: filterListResult,
		});
	}

	const getVideo = async (
		/** @type {any} */ video,
		/** @type {{ userId?: number, user?: { id?: number }, req?: { res?: any } }} */ params
	) => {
		const userId = params?.userId ?? params?.user?.id;

		const storedFlags = await readStoredFlags(storageManager, video);
		if (video) {
			const subscriberOnly = globalSubscriberOnly
				? true
				: storedFlags?.subscriberOnly;
			const denyDownload = globalDenyDownload
				? true
				: storedFlags?.denyDownload;
			video.pluginData = {
				...(video.pluginData || {}),
				[VIDEO_FIELD_SUBSCRIBER_ONLY]: subscriberOnly ? true : false,
				[VIDEO_FIELD_DENY_DOWNLOAD]: denyDownload ? true : false,
			};
		}

		try {
			const canAccess = await canAccessVideo(
				peertubeHelpers,
				userId,
				video,
				globalSubscriberOnly
			);

			if (canAccess) {
				return video;
			}
		} catch (err) {
			logger.error('Failed to check subscriber-only access', {
				err,
				userId,
				videoId: video?.id,
			});
		}

		if (params?.req?.res) {
			params.req.res.statusCode = 403;
		}

		video = markVideoRestricted(video);

		return video;
	};

	registerHook({
		target: 'filter:api.video.get.result',
		handler: getVideo,
	});

	registerHook({
		target: 'filter:api.download.video.allowed.result',
		handler: denyDownload,
	});

	registerHook({
		target: 'filter:api.download.generated-video.allowed.result',
		handler: denyDownload,
	});

	registerHook({
		target: 'action:api.video.updated',
		handler: async (/** @type {{ video?: any, body?: any }} */ params) => {
			if (globalSubscriberOnly || globalDenyDownload) return;
			const flags = getFlagsFromBody(params?.body);
			if (!flags || !params?.video) return;

			try {
				await storeFlags(storageManager, params.video, flags);
			} catch (err) {
				logger.error('Failed to store plugin video flags', {
					err,
					videoId: params?.video?.id,
				});
			}
		},
	});
}

async function unregister() {
	return;
}

module.exports = {
	register,
	unregister,
};
