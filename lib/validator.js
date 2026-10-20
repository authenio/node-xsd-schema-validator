const os = require('os');
const path = require('path');

const spawn = require('child_process').spawn;
const CLASSPATH_SEPARATOR = os.platform() === 'win32' ? ';' : ':';
const JAVA_HOME = process.env.JAVA_HOME;
const BASE_DIR = path.resolve(__dirname + '/../');

// Assume jvm/jdk are on the PATH if JAVA_HOME is not set
const JAVA = JAVA_HOME ? JAVA_HOME + '/bin/java' : 'java';

function stripLineEnding(str) {
  return str.replace(/[\r\n]+/g, '');
}

/**
 * Pass the current working directory as an argument
 *
 * @param {Object} [options] directory to search for schema resources and includes.
 */
function Validator(options) {
  options = options || {};

  this.cwd = options.cwd || process.cwd();
  this.debug = !!options.debug;
}

/**
 * Validate a xml file against the given schema
 *
 * @param {String|Buffer|ReadableStream|Object} xml
 * @param {String} schema path to schema
 * @param {Function} callback to be invoked with (err, result)
 */
Validator.prototype.validateXML = function (xml, schema, callback) {

  const cwd = this.cwd;
  const debug = this.debug;

  // validate input and set validator mode
  let input;

  // plain string
  if (typeof xml === 'string') {
    input = {
      str: xml
    };
  } else

    // readable stream
    if (typeof xml.pipe === 'function') {
      input = {
        stream: xml
      };
    } else

      // buffer
      if (xml instanceof Buffer) {
        input = {
          buffer: xml
        };
      } else

        // file
        if (xml.file) {
          input = xml;
        }

  if (!input) {
    return callback(
      new Error(
        'unsupported <xml> parameter: ' +
        'expected String|Buffer|ReadableStream|Object={ file: path }'
      )
    );
  }

  const validator = spawn(JAVA, [
    '-Dfile.encoding=UTF-8',
    '-classpath',
    [BASE_DIR, cwd].join(CLASSPATH_SEPARATOR),
    'support.XMLValidator',
    input.file ? '-file=' + xml.file : '-stdin',
    '-schema=' + schema
  ], { cwd: cwd });

  let result, code;
  const messages = [];
  let done = false;

  function finish(result, code) {
    // 'exit' and the result line can both complete validation; report once.
    if (done) {
      return;
    }
    done = true;
    const success = !code;
    const err = success ? null : buildError(result);

    callback(err, {
      valid: success,
      result: result,
      messages: messages
    });
  }

  function handleText(data) {
    const msg = data.toString('utf-8');

    if (msg.indexOf('[') === 0) {
      messages.push(stripLineEnding(msg));
    } else
      if (msg.indexOf('result=') === 0) {
        result = stripLineEnding(msg.slice('result='.length));

        if (code !== undefined) {
          finish(result, code);
        }
      } else {
        if (debug) {
          console.log(msg);
        }
      }
  }

  function buildError(result) {
    let msg = 'invalid xml (status=' + result + ')';
    messages.forEach(function (m) {
      msg += '\n\t' + m;
    });

    return new Error(msg);
  }

  validator.on('exit', function (exitCode) {
    code = exitCode;

    finish(result ? result : code ? 'WITH_ERRORS' : 'OK', code);
  });

  validator.stderr.on('data', handleText);
  validator.stdout.on('data', handleText);


  // The JVM could not be started (e.g. java missing).
  validator.on('error', function () {
    finish('WITH_ERRORS', code !== undefined ? code : 1);
  });

  const stdin = validator.stdin;

  // The validator may stop reading and exit as soon as it finds a fatal error;
  // writing the rest of a large input then fails with EPIPE. Without a
  // listener that error would terminate the process. The validation result
  // is still reported through 'exit'.
  stdin.on('error', function () {});

  if (input.stream) {
    input.stream.on('end', function () {
      input.stream.unpipe(stdin);
    });

    return input.stream.pipe(stdin);
  }

  if (input.str) {
    stdin.write(input.str);
  }

  if (input.buffer) {
    stdin.write(input.buffer.toString());
  }

  // end input
  stdin.end();

};

module.exports = Validator;

/**
 * Validate xml based on the given schema.
 *
 * @param {String|ReadableStream} xml
 * @param {String} schema
 *
 * @param {Function} callback
 */
module.exports.validateXML = function (xml, schema, callback) {
  return new Validator().validateXML(xml, schema, callback);
};
