let Assert = require('../Assert');
let Dependencies = require('../Dependencies');
let mergeWebpackConfig = require('../builder/MergeWebpackConfig');

let components = [
    'JavaScript',
    'Preact',
    'React',
    'Coffee',
    'TypeScript',
    'Less',
    'Sass',
    'Stylus',
    'PostCss',
    'CssWebpackConfig',
    'BrowserSync',
    'Combine',
    'Copy',
    'Autoload',
    'Alias',
    'Vue',
    'React',
    'Preact',
    'Version',
    'Extend',
    'Extract',
    'Notifications',
    'DisableNotifications',
    'PurifyCss',
    'LegacyNodePolyfills',
    'WebpackConfig',
    'DumpWebpackConfig',
    'Then',
    'Override',
    'SourceMaps',
    'SetPublicPath',
    'SetResourceRoot',
    'Options',
    'When',
    'BabelConfig',
    'Before'
];

class ComponentRegistrar {
    /**
     * @param {import("../Mix")} mix
     */
    constructor(mix) {
        this.mix = mix;
        this.components = {};
    }

    /**
     * Install all default components.
     */
    installAll() {
        components.map(name => require(`./${name}`)).forEach(this.install.bind(this));

        return this.components;
    }

    /**
     * Install a component.
     *
     * @param {Component} Component
     */
    install(Component) {
        let component = typeof Component === 'function' ? new Component() : Component;

        this.registerComponent(component);

        this.mix.listen('internal:gather-dependencies', () => {
            if (!component.activated && !component.passive) {
                return;
            }

            if (!component.dependencies) {
                return;
            }

            Dependencies.queue(
                component.dependencies(),
                component.requiresReload || false
            );
        });

        this.mix.listen('init', () => {
            if (!component.activated && !component.passive) {
                return;
            }

            component.boot && component.boot();
            component.babelConfig && this.applyBabelConfig(component);

            this.mix.listen('loading-entry', entry => {
                component.webpackEntry && component.webpackEntry(entry);
            });

            this.mix.listen('loading-rules', rules => {
                component.webpackRules && this.applyRules(rules, component);
            });

            this.mix.listen('loading-plugins', plugins => {
                component.webpackPlugins && this.applyPlugins(plugins, component);
            });

            this.mix.listen('configReady', config => {
                component.webpackConfig && component.webpackConfig(config);
            });
        });

        return this.components;
    }

    /**
     * Register the component.
     *
     * @param {Object} component
     */
    registerComponent(component) {
        const names =
            typeof component.name === 'function'
                ? [].concat(component.name())
                : [
                      component.constructor.name.replace(/^([A-Z])/, letter =>
                          letter.toLowerCase()
                      )
                  ];

        /**
         *
         * @param {string} name
         */
        const register = name => {
            this.components[name] = (...args) => {
                this.context.components.record(name, component);

                component.caller = name;

                component.register && component.register(...args);

                component.activated = true;

                return this.components;
            };

            // If we're dealing with a passive component that doesn't
            // need to be explicitly triggered by the user, we'll
            // call it now.
            if (component.passive) {
                this.components[name]();
            }

            // Components can optionally write to the Mix API directly.
            if (component.mix) {
                Object.keys(component.mix()).forEach(name => {
                    this.components[name] = component.mix()[name];
                });
            }
        };

        names.forEach(name => register(name));
    }

    /**
     * Install the component's dependencies.
     *
     * @deprecated
     * @param {Object} component
     */
    installDependencies(component) {
        []
            .concat(component.dependencies())
            .filter(dependency => dependency)
            .tap(dependencies => {
                Assert.dependencies(dependencies, component.requiresReload);
            });
    }

    /**
     *
     * Apply the Babel configuration for the component.
     *
     * @param {Object} component
     */
    applyBabelConfig(component) {
        this.mix.config.babelConfig = mergeWebpackConfig(
            this.mix.config.babelConfig,
            component.babelConfig()
        );
    }

    /**
     *
     * Apply the webpack rules for the component.
     *
     * @param {any[]} rules
     * @param {Object} component
     */
    async applyRules(rules, component) {
        const newRules = component.webpackRules();

        newRules && rules.push(...[].concat(newRules));
    }

    /**
     *
     * Apply the webpack plugins for the component.
     *
     * @param {any[]} plugins
     * @param {Object} component
     */
    applyPlugins(plugins, component) {
        const newPlugins = component.webpackPlugins();

        newPlugins && plugins.push(...[].concat(newPlugins));
    }
}

module.exports = ComponentRegistrar;
