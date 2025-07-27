/*
 * Logger Service
 * Provides configurable logging functionality with various log levels
 *
 * @author Akash Devanarayana
 * @date 2025-07-25
 * @version 1.0.0
 *
 */

/**
 * Log levels in order of severity
 */
const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    FATAL: 'fatal'
};

const LOG_LEVEL_VALUES = {
    [LOG_LEVELS.DEBUG]: 0,
    [LOG_LEVELS.INFO]: 1,
    [LOG_LEVELS.WARN]: 2,
    [LOG_LEVELS.ERROR]: 3,
    [LOG_LEVELS.FATAL]: 4
};

/**
 * Default configuration for the logger
 */
const DEFAULT_CONFIG = {
    level: LOG_LEVELS.INFO,
    includeTimestamp: true,
    includeLevel: true,
    timestampFormat: 'ISO', // 'ISO' or 'LOCALE'
    colorOutput: true
};

// ANSI color codes for terminal output
const COLORS = {
    reset: '\x1b[0m',
    debug: '\x1b[36m', // Cyan
    info: '\x1b[32m',  // Green
    warn: '\x1b[33m',  // Yellow
    error: '\x1b[31m', // Red
    fatal: '\x1b[35m'  // Magenta
};

let instance = null;

/**
 * Logger class with configurable log levels and formatting
 */
class Logger {
    /**
     * Create a new logger instance
     *
     * @param {Object} config - Configuration options
     */
    constructor(config = {}) {
        this.config = {...DEFAULT_CONFIG, ...config};

        // Validate the configured log level
        if (!LOG_LEVELS[this.config.level.toUpperCase()] &&
            !Object.values(LOG_LEVELS).includes(this.config.level)) {
            throw new Error(`Invalid log level: ${this.config.level}`);
        }
    }

    /**
     * Format a log message based on configuration
     *
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @returns {string} - Formatted log message
     */
    formatMessage(level, message) {
        const parts = [];

        // Add timestamp if configured
        if (this.config.includeTimestamp) {
            const timestamp = this.config.timestampFormat === 'ISO'
                ? new Date().toISOString()
                : new Date().toLocaleString();
            parts.push(`[${timestamp}]`);
        }

        // Add log level if configured
        if (this.config.includeLevel) {
            parts.push(`[${level.toUpperCase()}]`);
        }

        // Add the log message
        parts.push(message);

        return parts.join(' ');
    }

    /**
     * Determine if a message at the given level should be logged
     *
     * @param {string} level - Log level to check
     * @returns {boolean} - True if the message should be logged
     */
    shouldLog(level) {
        const configuredLevel = LOG_LEVEL_VALUES[this.config.level.toLowerCase()];
        const messageLevel = LOG_LEVEL_VALUES[level.toLowerCase()];

        return messageLevel >= configuredLevel;
    }

    /**
     * Log a message at the specified level
     *
     * @param {string} level - Log level
     * @param {string} message - Message to log
     * @param {Object} [data] - Additional data to log
     */
    log(level, message, data) {
        if (!this.shouldLog(level)) {
            return;
        }

        const formattedMessage = this.formatMessage(level, message);

        if (this.config.colorOutput && COLORS[level.toLowerCase()]) {
            const color = COLORS[level.toLowerCase()];
            console[level.toLowerCase() === 'fatal' ? 'error' : level.toLowerCase()](
                `${color}${formattedMessage}${COLORS.reset}`,
                data ? data : ''
            );
        } else {
            console[level.toLowerCase() === 'fatal' ? 'error' : level.toLowerCase()](
                formattedMessage,
                data ? data : ''
            );
        }
    }

    /**
     * Log a debug message
     * @param {string} message - Message to log
     * @param {Object} [data] - Additional data to log
     */
    debug(message, data) {
        this.log(LOG_LEVELS.DEBUG, message, data);
    }

    /**
     * Log an info message
     * @param {string} message - Message to log
     * @param {Object} [data] - Additional data to log
     */
    info(message, data) {
        this.log(LOG_LEVELS.INFO, message, data);
    }

    /**
     * Log a warning message
     * @param {string} message - Message to log
     * @param {Object} [data] - Additional data to log
     */
    warn(message, data) {
        this.log(LOG_LEVELS.WARN, message, data);
    }

    /**
     * Log an error message
     * @param {string} message - Message to log
     * @param {Object} [data] - Additional data to log
     */
    error(message, data) {
        this.log(LOG_LEVELS.ERROR, message, data);
    }

    /**
     * Log a fatal error message
     * @param {string} message - Message to log
     * @param {Object} [data] - Additional data to log
     */
    fatal(message, data) {
        this.log(LOG_LEVELS.FATAL, message, data);
    }

    /**
     * Change the logger configuration
     * @param {Object} newConfig - New configuration options
     */
    updateConfig(newConfig) {
        this.config = {...this.config, ...newConfig};
    }
}

/**
 * Create and return the singleton logger instance
 */
function getLogger(config = {}) {
    if (!instance) {
        instance = new Logger(config);
    } else if (Object.keys(config).length > 0) {
        // Optionally update config if provided
        instance.updateConfig(config);
    }
    return instance;
}

module.exports = {
    Logger,
    getLogger,
    LOG_LEVELS
};
