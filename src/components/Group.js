/**
 * @typedef {(mix: import("../Mix")['api'], context: import("../Mix")) => void} GroupCallback
 */

class Group {
    /**
     *
     * @param {import('../Mix')} context
     */
    constructor(context) {
        this.parent = context;
    }

    /**
     * Add resolution aliases to webpack's config
     *
     * @param {string} name
     * @param {GroupCallback} [callback]
     */
    register(name, callback) {
        if (!callback) {
            throw new Error('A callback must be passed to mix.group()');
        }

        const shouldBuild = name === process.env.MIX_GROUP || !process.env.MIX_GROUP;

        if (!shouldBuild) {
            return;
        }

        this.parent.withChild(name, context => callback(context.api, context));
    }
}

module.exports = Group;
