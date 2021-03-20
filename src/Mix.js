let { Chunks } = require('./Chunks');
let buildConfig = require('./config');
let ComponentRegistrar = require('./components/ComponentRegistrar');
let Components = require('./components/Components');
let Dependencies = require('./Dependencies');
let Dispatcher = require('./Dispatcher');
let Dotenv = require('dotenv');
let File = require('./File');
let HotReloading = require('./HotReloading');
let Manifest = require('./Manifest');
let Paths = require('./Paths');
let WebpackConfig = require('./builder/WebpackConfig');
let { Resolver } = require('./Resolver');

/** @typedef {import("./tasks/Task")} Task */

/**
 * @typedef {object} ContextOptions
 * @property {string} name
 */

class Mix {
    /** @type {Mix|null} */
    static _primary = null;

    /** @type {Record<string, boolean>} */
    static _hasWarned = {};

    /** @type {Mix[]} */
    static current = [];

    /**
     * Create a new instance.
     * @param {Partial<ContextOptions>} options
     */
    constructor(options = {}) {
        this.options = this.resolveOptions(options);

        /** @type {ReturnType<buildConfig>} */
        this.config = buildConfig(this);

        this.chunks = new Chunks(this);
        this.components = new Components();
        this.dispatcher = new Dispatcher();
        this.manifest = new Manifest();
        this.paths = new Paths();
        this.registrar = new ComponentRegistrar(this);
        this.webpackConfig = new WebpackConfig(this);
        this.hot = new HotReloading(this);
        this.resolver = new Resolver();

        /** @type {Task[]} */
        this.tasks = [];

        /** @type {Mix[]} */
        this.children = [];

        this.booted = false;

        this.bundlingJavaScript = false;

        /**
         * @internal
         * @type {boolean}
         **/
        this.initialized = false;

        /**
         * @internal
         * @type {string|null}
         */
        this.globalStyles = null;

        /**
         * @internal
         * @type {boolean|string}
         **/
        this.extractingStyles = false;
    }

    /**
     * Create a new instance.
     * @param {Partial<ContextOptions>} options
     * @returns {ContextOptions}
     */
    resolveOptions(options) {
        /** @type {ContextOptions} */
        const defaults = {
            name: 'Mix'
        };

        return {
            ...defaults,
            ...options
        };
    }

    /**
     * @internal
     */
    static get primary() {
        return Mix._primary || (Mix._primary = new Mix());
    }

    /**
     * @internal
     * @returns {Promise<import('webpack').Configuration[]>}
     */
    async build() {
        if (!this.booted) {
            console.warn(
                'Mix was not set up correctly. Please ensure you import or require laravel-mix in your mix config.'
            );

            this.boot();
        }

        return await Promise.all(this.buildConfigs());
    }

    /**
     * Build the webpack configs for this context and all of its children
     *
     * @internal
     * @returns {Generator<Promise<import('webpack').Configuration>, any, undefined>}
     */
    *buildConfigs() {
        // We do not want to build this config if it doesn't do anything
        // This is because it will produce no files but still result in progress output
        // This is likely not what the user would expect
        if (this.children.length === 0) {
            yield this.webpackConfig.build();
        }

        for (const child of this.children) {
            yield* child.buildConfigs();
        }
    }

    /**
     * @internal
     * @returns {Mix}
     */
    boot() {
        if (this.booted) {
            return this;
        }

        this.booted = true;

        if (this === Mix._primary) {
            // Load .env
            Dotenv.config();
        }

        // If we're using Laravel set the public path by default
        if (this.sees('laravel')) {
            this.config.publicPath = 'public';
        }

        this.listen('init', () => this.hot.record());
        this.pushCurrent();

        return this;
    }

    /**
     * @internal
     */
    async installDependencies() {
        await this.dispatch('internal:gather-dependencies');
        await this.dispatchToChildren('internal:gather-dependencies');

        Dependencies.installQueued();
    }

    /**
     * @internal
     */
    async init() {
        if (this.initialized) {
            return;
        }

        this.initialized = true;

        await this.dispatch('init', this);
        await this.dispatchToChildren('init', this);
    }

    /**
     * @returns {import("../types/index")}
     */
    get api() {
        if (!this._api) {
            this._api = this.registrar.installAll();

            // @ts-ignore
            this._api.inProduction = () => this.config.production;
        }

        // @ts-ignore
        return this._api;
    }

    /**
     * Determine if the given config item is truthy.
     *
     * @param {string} tool
     */
    isUsing(tool) {
        // @ts-ignore
        return !!this.config[tool];
    }

    /**
     * Determine if Mix is executing in a production environment.
     */
    inProduction() {
        return this.config.production;
    }

    /**
     * Determine if Mix should use HMR.
     */
    isHot() {
        return process.argv.includes('--hot');
    }

    /**
     * Determine if Mix should watch files for changes.
     */
    isWatching() {
        return this.isHot() || process.argv.includes('--watch');
    }

    /**
     * Determine if polling is used for file watching
     */
    isPolling() {
        const hasPollingOption = process.argv.some(arg =>
            arg.includes('--watch-options-poll')
        );

        return this.isWatching() && hasPollingOption;
    }

    /**
     * Determine if Mix sees a particular tool or framework.
     *
     * @param {string} tool
     */
    sees(tool) {
        if (tool === 'laravel') {
            return File.exists('./artisan');
        }

        return false;
    }

    /**
     * Determine if the given npm package is installed.
     *
     * @param {string} npmPackage
     */
    seesNpmPackage(npmPackage) {
        try {
            require.resolve(npmPackage);

            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Queue up a new task.
     *
     * @param {Task} task
     */
    addTask(task) {
        this.tasks.push(task);
    }

    /**
     * Listen for the given event.
     *
     * @param {string|string}   event
     * @param {import('./Dispatcher').Handler} callback
     */
    listen(event, callback) {
        this.dispatcher.listen(event, callback);
    }

    /**
     * Dispatch the given event.
     *
     * @param {string} event
     * @param {any | (() => any)}      [data]
     */
    async dispatch(event, data) {
        return this.whileCurrent(() => {
            if (typeof data === 'function') {
                data = data();
            }

            return this.dispatcher.fire(event, data);
        });
    }

    /**
     * Dispatch the given event.
     *
     * @param {string} event
     * @param {any | (() => any)}      [data]
     */
    async dispatchToChildren(event, data) {
        const promises = this.children.map(child => child.dispatch(event, data));
        const results = await Promise.all(promises);

        return results;
    }

    /**
     * @param {string} name
     * @internal
     */
    resolve(name) {
        return this.resolver.get(name);
    }

    pushCurrent() {
        Mix.current.push(this.makeCurrent());
    }

    popCurrent() {
        Mix.current.pop();

        const context = Mix.current[Mix.current.length - 1];

        context && context.makeCurrent();
    }

    /**
     * @template T
     * @param {string} name
     * @param {(context: Mix) => T|Promise<T>} callback
     */
    withChild(name, callback) {
        const context = new Mix({ name }).boot();

        this.children.push(context);

        return context.whileCurrent(callback);
    }

    /**
     * @template T
     * @param {(context: Mix) => T|Promise<T>} callback
     */
    whileCurrent(callback) {
        this.pushCurrent();

        try {
            const result = callback(this);

            if (result instanceof Promise) {
                return result.finally(() => this.popCurrent());
            }
        } catch (err) {
            this.popCurrent();

            throw err;
        }

        this.popCurrent();
    }

    /**
     * @internal
     */
    makeCurrent() {
        // Set up some globals

        // @ts-ignore
        global.Config = this.config;

        // @ts-ignore
        global.Mix = this;

        // @ts-ignore
        global.webpackConfig = this.webpackConfig;

        this.chunks.makeCurrent();

        return this;
    }
}

module.exports = Mix;
