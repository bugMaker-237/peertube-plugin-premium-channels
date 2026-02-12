// @ts-check

/**
 * @typedef {import('@peertube/peertube-types/client').RegisterClientOptions} RegisterClientOptions
 * @typedef {import('@peertube/peertube-types').RegisterClientVideoFieldOptions} RegisterClientVideoFieldOptions
 */

const VIDEO_FIELD_SUBSCRIBER_ONLY = 'subscriber-only';
const VIDEO_FIELD_DENY_DOWNLOAD = 'deny-download';
const PLUGIN_BLOCKED_FLAG = 'subscriber-only-blocked';
const SETTING_REMOVE_SUBSCRIBE_BUTTON = 'remove-subscribe-button';
const SETTING_DEFAULT_SUBSCRIBER_ONLY = 'default-subscriber-only';
const SETTING_DEFAULT_DENY_DOWNLOAD = 'default-deny-download';
const SETTING_GLOBAL_SUBSCRIBER_ONLY = 'global-subscriber-only';
const SETTING_GLOBAL_DENY_DOWNLOAD = 'global-deny-download';

/** @type {Array<RegisterClientVideoFieldOptions['type']>} */
const VIDEO_FIELD_TYPES = [
	'update',
	'upload',
	'import-url',
	'import-torrent',
	'go-live',
];

/**
 * @param {RegisterClientOptions} options
 */
async function register({ registerHook, registerVideoField, peertubeHelpers }) {
	const { translate } = peertubeHelpers;
	let blockedModalShown = false;
	const settings = await peertubeHelpers.getSettings();
	const removeSubscribeButtonEnabled =
		settings[SETTING_REMOVE_SUBSCRIBE_BUTTON] === true;
	const defaultSubscriberOnly =
		settings[SETTING_DEFAULT_SUBSCRIBER_ONLY] === true;
	const defaultDenyDownload = settings[SETTING_DEFAULT_DENY_DOWNLOAD] === true;
	const globalSubscriberOnly =
		settings[SETTING_GLOBAL_SUBSCRIBER_ONLY] === true;
	const globalDenyDownload = settings[SETTING_GLOBAL_DENY_DOWNLOAD] === true;

	const removeSubscribeButton = () => {
		if (!removeSubscribeButtonEnabled) return;
		const selectors = [
			'my-subscribe-button',
			'button.subscribe-button',
			'button[data-pt-subscribe-button]',
			'button[aria-label*="Subscribe"]',
			'button[aria-label*="Unsubscribe"]',
			'a[aria-label*="Subscribe"]',
			'a[aria-label*="Unsubscribe"]',
		];

		for (const selector of selectors) {
			/** @type {NodeListOf<HTMLElement>} */
			const elements = document.querySelectorAll(selector);
			elements.forEach((el) => el.replaceWith(document.createElement('div')));
		}
	};

	const scheduleRemoveSubscribeButton = () => {
		removeSubscribeButton();

		let attempts = 0;
		const timer = setInterval(() => {
			removeSubscribeButton();
			attempts += 1;

			if (attempts >= 10) {
				clearInterval(timer);
			}
		}, 300);
	};

	for (const type of VIDEO_FIELD_TYPES) {
		registerVideoField(
			{
				name: VIDEO_FIELD_SUBSCRIBER_ONLY,
				label: await translate('Subscribers only'),
				type: 'input-checkbox',
				hidden: () => globalSubscriberOnly,
				default: defaultSubscriberOnly,
				descriptionHTML: await translate(
					'Limit playback to subscribers of this channel.'
				),
			},
			{
				type,
				tab: 'plugin-settings',
			}
		);

		registerVideoField(
			{
				name: VIDEO_FIELD_DENY_DOWNLOAD,
				label: await translate('Disable downloads'),
				type: 'input-checkbox',
				hidden: () => globalDenyDownload,
				default: defaultDenyDownload,
				descriptionHTML: await translate(
					'Prevent all users from downloading this video.'
				),
			},
			{
				type,
				tab: 'plugin-settings',
			}
		);
	}

	registerHook({
		target: 'filter:api.video-watch.video.get.result',
		handler:
			/**
			 *
			 * @param {*} result
			 * @returns
			 */
			async (result) => {
				if (
					!blockedModalShown &&
					result?.pluginData?.[PLUGIN_BLOCKED_FLAG] === 'true'
				) {
					blockedModalShown = true;
					peertubeHelpers.showModal({
						title: await translate('Subscribers only'),
						content: await translate(
							'This video is restricted to channel subscribers.'
						),
						cancel: {
							value: await translate('Close'),
						},
					});
				}

				return result;
			},
	});

	registerHook({
		target: 'action:video-watch.init',
		handler: scheduleRemoveSubscribeButton,
	});

	registerHook({
		target: 'action:video-watch.video.loaded',
		handler: scheduleRemoveSubscribeButton,
	});

	registerHook({
		target: 'action:video-channel-videos.init',
		handler: scheduleRemoveSubscribeButton,
	});

	registerHook({
		target: 'action:video-channel-videos.video-channel.loaded',
		handler: scheduleRemoveSubscribeButton,
	});

	registerHook({
		target: 'action:video-channel-playlists.init',
		handler: scheduleRemoveSubscribeButton,
	});

	registerHook({
		target: 'action:video-channel-playlists.video-channel.loaded',
		handler: scheduleRemoveSubscribeButton,
	});

	registerHook({
		target: 'action:router.navigation-end',
		handler: scheduleRemoveSubscribeButton,
	});
}

export { register };
