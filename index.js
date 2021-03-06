const fs = require("fs");
const path = require("path");
const mkpath = require('mkpath');

const lodash = require('lodash');
const colors = require('colors/safe');

const nodePreprocessor = require("node-preprocessor");
const uglifyJs = require("uglify-js");
const glob = require("glob");


// TODO:
//  cmd copy on entire folder with subfolders
//  end/or cmd copy with filtering path (ex. 'htmla/**/*.*')

//TODO: glob npm package to recursively scrape files

// #region config

let verbose_console = false;
let verbose_html = true;

/* const source_path = 'src/templates';
const output_path = "output";

const config_path = path.join(__dirname, 'config');
const config_file_name = 'build-config.';
const config_file_ext = 'json';
const config_file = config_file_name + config_file_ext; */
let source_path, output_path;

let config_path, config_file_name, config_file_ext, config_file;


// set theme
colors.setTheme({
  silly: 'rainbow',
  input: 'grey',
  verbose: 'cyan',
  prompt: 'grey',
  info: 'green',
  data: 'grey',
  help: 'cyan',
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
});

// #endregion


// #region helpers

let htmlResults;

// TODO: configurable
const _logInfo = console.info.bind(console);
const _logError = function(title, error) {
  console.error(colors.error(title));
  console.error(colors.error(error));

  verbose_html && htmlResults.push(`
<hr/>
<h4 style="color:red">Error: ${title}<h4>
<p style="color:red">
  <pre>${JSON.stringify(error)}</pre>
</p>
  `);
}

function _logTitle(title, ...args) {
  verbose_console && console.log(colors.info(title), ...args);

  verbose_html && htmlResults.push(`
<hr/>
<h4>${title}<h4>
<ul>
  ${args.map(arg => `<li>${typeof arg === 'object' ? `<pre>${JSON.stringify(arg)}</pre>` : arg}</li>`)}
</ul>
  `);
}

function _logAction(title, source, target, params) {
  if (verbose_console) {
    _logInfo(colors.input("- " + (Array.isArray(title) ? title.join(' ') : title) + "\t"));
    source && _logInfo(colors.verbose("   source:\t\t"), source);
    target && _logInfo(colors.verbose("   target:\t\t"), target);
    params && _logInfo(colors.verbose("   params:"), JSON.stringify(params, null, 12));
  }

  verbose_html && htmlResults.push(`
<fieldset>
  <legend>${Array.isArray(title) ? `${title.shift()} <small>${title.join(' ')}</small>` : title}</legend>
  <table>
  ${source ? `<tr><td><i>source</i></td><td>${source}</td></tr>` : ''}
  ${target ? `<tr><td><i>target</i></td><td>${target}</td></tr>` : ''}
  ${params ? `<tr><td><i>params</i></td><td><pre>${JSON.stringify(params, null, 2)}</pre></td></tr>` : ''}
  </table>
</fieldset>
  `);
}

// #endregion


// #region config loader

const loadContextesSet = (function() {
  function parseFileContextesRecursively(
    ctx,
    pCtxConfig, pCtxParams,
    _path, resSet
  ) {
    resSet = resSet || {};
    _path = (_path || []).concat();
  
    // clone params and add current context's params
    const config = lodash.merge({}, pCtxConfig, ctx._config);
    const params = lodash.merge({}, pCtxParams, ctx._params);
  
    Object.keys(ctx)
    .filter(key => key !== "_config")
    .filter(key => key !== "_params")
    .forEach(key => {
      let ctxValue = ctx[key];
      
      if (typeof ctxValue == "string") {
        const resKey = path.join.apply(path, _path.concat(key))
  
        resSet[resKey] = {
          //path: path.join(source_path, ctxValue),
          value: ctxValue,
          config,
          params //: params.join(" ")
        };
      } else {
        parseFileContextesRecursively(ctxValue, config, params, _path.concat(key), resSet);
      }
    });
  
    return resSet;
  }

  return function () {
    const config_fullpath = path.join(config_path, config_file);
    const baseConfig = require(config_fullpath);
    
    return glob.sync(path.join(config_path, config_file_name + "*." + config_file_ext))
    .map(fileFull => {
      const key = fileFull.split('.')[1]; // TODO: regex
      const configEnv = require(fileFull);

      return {
        value: parseFileContextesRecursively(configEnv, baseConfig._config, baseConfig._params),
        key
      };
    });
  }
})();

// #endregion


// #region commands

// #region post-process

const postProcess = (function() {
  // privating variables inside same module

  const postProcessCmdSet = {
    "js": function(sourceCode, config) {
      const minified = uglifyJs.minify(sourceCode, config);
  
      if (minified.error) {
        return {
          error: minified.error
        }
      }
  
      return minified.code;
    },
    "css": function(sourceCode, config) {
      const cleanCss = new (require('clean-css'))(config);
  
      return cleanCss.minify(sourceCode);
    },
    "html": function(sourceCode, config) {
      const htmlMinifier = require('html-minifier').minify;
  
      return htmlMinifier(sourceCode, config);
    }
  };

  return function(fileArgs, next) {
    const configPostProcess = fileArgs.config["post-process"];
    if (!configPostProcess) {
      next();
      return;
      //maybe is better: return next();
    }

    const _postProcessCmdKey = fileArgs.paths.fileToExt.substring(1);
    const _postProcessCmdConfig = configPostProcess[_postProcessCmdKey];

    if (_postProcessCmdConfig) {
      const _postProcessCmdFunc = postProcessCmdSet[_postProcessCmdKey];
      if (!_postProcessCmdFunc) {
        next(new Error("Configuration key '" + _postProcessCmdKey + "' not found for post-process commands!"));
        return;
      }

      _logAction("Postprocessing", fileArgs.paths.fileToFull);

      const minified = _postProcessCmdFunc(fileArgs.code, _postProcessCmdConfig);

      if (minified.error) {
        next(minified.error);
      } else {
        fileArgs.code = minified;

        //TODO: save as minified filename???
        //const fileMinToName = `${fileArgs.paths.fileToName.replace(/\.[^/.]+$/, "")}.min${fileArgs.paths.fileToExt}`;
        //const fileMinToFull = path.join(fileArgs.paths.fileToPath, fileMinToName);
        //fs.writeFile(fileMinToFull, minified, next);
      }
    }

    next();
  }
})();

// #endregion

const cmdSet = {
  "PREPROCESS": function (fileArgs, next) {
    _logAction("Reading", fileArgs.paths.fileFromFull, fileArgs.paths.fileToFull);
  
    fs.readFile(fileArgs.paths.fileFromFull, (err, data) => {
      _logAction("Compiling", fileArgs.paths.fileFromFull, fileArgs.paths.fileToFull, fileArgs.params);
  
      const text = data.toString();
      const preprocessedCode = nodePreprocessor.preprocess(text, fileArgs.params);

      fileArgs.code = preprocessedCode;
      //fs.writeFile(fileArgs.paths.fileToFull, preprocessedCode, next);

      next();
    });
  },
  "POSTPROCESS": postProcess,
  "PERSIST": function (fileArgs, next) {
    mkpath.sync(fileArgs.paths.fileToPath);
    
    if (fileArgs.code) {
      _logAction("Persisting", fileArgs.paths.fileFromFull, fileArgs.paths.fileToFull);

      fs.writeFile(fileArgs.paths.fileToFull, fileArgs.code, next);
    } else {
      _logAction("Copying", fileArgs.paths.fileFromFull, fileArgs.paths.fileToFull);

      if (fileArgs.paths.isFolder) {
        var rCopy = require('recursive-copy');

        rCopy(fileArgs.paths.fileFromFull, fileArgs.paths.fileToFull, {
          overwrite: true
        }, function(error, results) {
          error ? next(error) : next();
        });
      } else {
        fs.copyFile(fileArgs.paths.fileFromFull, fileArgs.paths.fileToFull, next);
      }
    }
  }
};

// #endregion


// #region execute

function getFileArgs(fileContextKey, fileContext, targetPath) {
  let fileCtxValue = fileContext.value;
  const execCmdList = ['PREPROCESS', 'POSTPROCESS', 'PERSIST'];
  
  if (fileCtxValue[0] == '!') {
    // no processes for this file (only copy)
    fileCtxValue = fileCtxValue.substring(1);
    execCmdList.splice(0, 2);
  }

  if (glob.hasMagic(fileCtxValue)) {
    console.log("HASMAGICf", ileCtxValue);
  }
  
  const fileFromFull = path.join(source_path, fileCtxValue);
  const fileFromName = path.basename(fileFromFull);

  const fileToName = path.basename(fileContextKey);
  const fileToPath = path.join(targetPath, path.dirname(fileContextKey));

  return {
    paths: {
      fileFromFull,
      fileFromPath: path.dirname(fileFromFull),
      fileFromName,
      fileFromExt: path.extname(fileFromName),
      fileToFull: path.join(fileToPath, fileToName),
      fileToPath,
      fileToName,
      fileToExt: path.extname(fileToName),
      isFolder: fs.statSync(fileFromFull).isDirectory()
    },
    execCmdList,
    config: fileContext.config,
    params: fileContext.params,
    code: null
  };
}

function iterateContextItem(fileArgs, next) {
  if (!fileArgs.execCmdList.length) {
    next();
    return;
  }

  const execCmd = fileArgs.execCmdList.shift();
  _logAction(["Iterate", execCmd, "file item"], fileArgs.paths.fileFromFull, fileArgs.paths.fileToFull);
  
  if (execCmd in cmdSet) {
    cmdSet[execCmd](fileArgs, (err) => err ? next(err) : iterateContextItem(fileArgs, next));
  } else {
    throw Error("NO CMD SPECIFIED!");
  }
}

function globPatternRootPath(_path) {
  let rootValue = [];

  _path.split("/").some(val => {
    if (!glob.hasMagic(val)) {
      rootValue.push(val);
    } else {
      return true;
    }
  });

  return rootValue.join("/");

  /*return envItemValue.split("/").reduce((accum, path) => {
    if (!glob.hasMagic(path)) {
      accum.push(path);
    }
    return accum;
  }, []).join("/");*/
}

function globEnvContextItem(envItemKey, envContext) {
  const envItem = envContext.value[envItemKey];
  let envItemValue = envItem.value;
  
  const toParse = envItemValue[0] !== "!";
  if (!toParse) {
    envItemValue = envItemValue.substring(1);
  }

  if (glob.hasMagic(envItemValue)) {
    const fullPath = path.join(source_path, envItemValue);
    const globResults = glob.GlobSync(fullPath).found;
    const rootValue = globPatternRootPath(envItemValue);
  
    const envContextChild = globResults.reduce((accum, _value) => {
      const gValue = path.relative(source_path, _value);
      const gKey = path.join(envItemKey, path.relative(rootValue, gValue));
      accum[gKey] = {
        config: envItem.config,
        params: envItem.params,
        value: (toParse ? "" : "!") + gValue
      };
      return accum;
    }, {});

    delete envContext.value[envItemKey];
    Object.assign(envContext.value, envContextChild);
    /*envContext.value = {
      ...envContext.value,
      ...envContextChild
    };*/
  }
}

function iterateContextSet(err) {
  if (err) {
    _logError("iterateContextSet", err);
    return;
  }

  const envContext = envContextSet.shift();
  if (envContext) {
    _logTitle("Compiling Environment:", envContext.key);
    
    Object.keys(envContext.value)
    .forEach(envItemKey => {
      globEnvContextItem(envItemKey, envContext);
    });

    const envTargetPath = path.join(output_path, envContext.key);
    
    Object.keys(envContext.value)
    .map(itemKey => getFileArgs(itemKey, envContext.value[itemKey], envTargetPath))
    .forEach(fileArgs => {
      iterateContextItem(fileArgs, iterateContextSet);
    });
  }
}

// #endregion


// #region execution
let envContextSet;

module.exports = function treeprocess(
  _source_path, _output_path, _config_path,
  _verbose_console = true, _verbose_html = false
) {
  source_path = _source_path;
  output_path = _output_path;
  config_path = _config_path;
  
  verbose_console = _verbose_console;
  verbose_html = _verbose_html;

  htmlResults = [];

  config_file_name = 'build-config.';
  config_file_ext = 'json';
  config_file = config_file_name + config_file_ext;

  console.log(colors.info("Start executing!"));
  envContextSet = loadContextesSet();

  _logTitle("Environments:", envContextSet.map(item => item.key));
  iterateContextSet();
};

//so the program will not close instantly
//process.stdin.resume();
// TODO: if verbose_html
process.on('exit', function() {
  verbose_html && htmlResults.length && fs.writeFileSync(
    path.join(process.cwd(), typeof verbose_html === 'string' ? verbose_html : 'htmlResults.html'), `
<style>
  fieldset table tr {
    vertical-align: top;
  }

  fieldset table tr td pre {
    color: #444;
  }
</style>` +
    htmlResults.join('')
  );
});

// #endregion


/*
TODO: typescript
  struct nextableMethod = (err, ...args: any[]) => any|void
*/