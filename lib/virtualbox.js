"use strict";

// @todo use a promise library instead of so many callbacks

var exec = require('child_process').exec,
  host_platform = require('os').platform,
  logging = require('./logging'),
  vBoxManageBinary,
  known_OS_types = {
    WINDOWS: 'windows',
    MAC: 'mac',
    LINUX: 'linux'
  },
  sessionPIDRegex = /\[(\d*) - Session (\d*)\]/;


// Host operating system
if (/^win/.test(host_platform)) {

  // Path may not contain VBoxManage.exe but it provides this environment variable
  vBoxManageBinary = '"' + process.env.VBOX_INSTALL_PATH + '\\VBoxManage.exe' + '" ';

} else if (/^darwin/.test(host_platform) || /^linux/.test(host_platform)) {

  // Mac OS X and most Linux use the same binary name, in the path
  vBoxManageBinary = 'vboxmanage ';

} else {

  // Otherwise (e.g., SunOS) hope it's in the path
  vBoxManageBinary = 'vboxmanage ';

}

function command(cmd, callback) {
  exec(cmd, function(err, stdout, stderr) {

    if (!err && stderr && cmd.indexOf("pause") !== -1 && cmd.indexOf("savestate") !== -1) {
      err = new Error(stderr);
    }

    callback(err, stdout);
  });
}

function vboxcontrol(cmd, callback) {
  command('VBoxControl ' + cmd, callback);
}

function vboxmanage(cmd, callback) {
  command(vBoxManageBinary + cmd, callback);
}

function pause(vmname, callback) {
  logging.info('Pausing VM "%s"', vmname);
  vboxmanage('controlvm "' + vmname + '" pause', function(error, stdout) {
    callback(error);
  });
}

function list(callback) {
  logging.info('Listing VMs');
  vboxmanage('list "runningvms"', function(error, stdout) {
    var _list = {};
    var _runningvms = parse_listdata(stdout);
    vboxmanage('list "vms"', function(error, full_stdout) {
      var _all = parse_listdata(full_stdout);
      var _keys = Object.keys(_all);
      for (var _i = 0; _i < _keys.length; _i += 1) {
        var _key = _keys[_i];
        if (_runningvms[_key]) {
          _all[_key].running = true;
        } else {
          _all[_key].running = false;
        }
      }
      callback(_all, error);
    });
  });
}

function parse_listdata(raw_data) {
  var _raw = raw_data.split('\n');
  var _data = {};
  if (_raw.length > 0) {
    for (var _i = 0; _i < _raw.length; _i += 1) {
      var _line = _raw[_i];
      if (_line === '') {
        continue;
      }
      // "centos6" {64ec13bb-5889-4352-aee9-0f1c2a17923d}
      var rePattern = new RegExp(/^\"(.+)\" \{(.+)\}$/);
      var arrMatches = _line.match(rePattern);
      // {'64ec13bb-5889-4352-aee9-0f1c2a17923d': 'centos6'}
      if (arrMatches.length === 3) {
        _data[arrMatches[2].toString()] = {
          name: arrMatches[1].toString()
        };
      }
    }
  }
  return _data;
}

function reset(vmname, callback) {
  logging.info('Resetting VM "%s"', vmname);
  vboxmanage('controlvm "' + vmname + '" reset', function(error, stdout) {
    callback(error);
  });
}

function resume(vmname, callback) {
  logging.info('Resuming VM "%s"', vmname);
  vboxmanage('controlvm "' + vmname + '" resume', function(error, stdout) {
    callback(error);
  });
}

function start(vmname, use_gui, callback) {
  var start_opts = ' --type ';
  if ((typeof use_gui) === 'function') {
    callback = use_gui;
    use_gui = false;
  }
  start_opts += (use_gui ? 'gui' : 'headless');

  logging.info('Starting VM "%s" with options: ', vmname, start_opts);

  vboxmanage('-nologo startvm "' + vmname + '"' + start_opts, function(error, stdout) {
    if (error && /VBOX_E_INVALID_OBJECT_STATE/.test(error.message)) {
      error = undefined;
    }
    callback(error);
  });
}

function stop(vmname, callback) {
  logging.info('Stopping VM "%s"', vmname);
  vboxmanage('controlvm "' + vmname + '" savestate', function(error, stdout) {
    callback(error);
  });
}

function savestate(vmname, callback) {
  logging.info('Saving State (alias to stop) VM "%s"', vmname);
  stop(vmname, callback);
}

function poweroff(vmname, callback) {
  logging.info('Powering off VM "%s"', vmname);
  vboxmanage('controlvm "' + vmname + '" poweroff', function(error, stdout) {
    callback(error);
  });
}

function acpipowerbutton(vmname, callback) {
  logging.info('ACPI power button VM "%s"', vmname);
  vboxmanage('controlvm "' + vmname + '" acpipowerbutton', function(error, stdout) {
    callback(error);
  });
}

function acpisleepbutton(vmname, callback) {
  logging.info('ACPI sleep button VM "%s"', vmname);
  vboxmanage('controlvm "' + vmname + '" acpisleepbutton', function(error, stdout) {
    callback(error);
  });
}

function parseExecOutput(stdout) {

  var match = sessionPIDRegex.exec(stdout);
  if (match) {
    return {
      pid: match[1],
      sessionId: match[2]
    };
  } else {
    return match;
  }

}

function vmSessionClose(options, callback) {

  var vm = options.vm || options.name || options.vmname || options.title;

  getVboxManageVersion(function(err, version) {
    if (err) {
      callback(err);
    } else {
      var major = Number(version.charAt(0));
      var greaterThan5 = !isNaN(major) && major < 5 ? false : true;
      var sessionCloseCmd = greaterThan5 ? 'closesession' : 'session close';
      var cmd = 'guestcontrol "' + vm + '" ' + sessionCloseCmd + ' --session-id ' + options.sessionId;
      vboxmanage(cmd, function(error, stdout) {
        callback(error);
      });
    }
  });

}

function vmProcessKill(options, callback) {

  var vm = options.vm || options.name || options.vmname || options.title;

  getVboxManageVersion(function(err, version) {
    if (err) {
      callback(err);
    } else {
      var major = Number(version.charAt(0));
      var greaterThan5 = !isNaN(major) && major < 5 ? false : true;
      var processKillCmd = greaterThan5 ? 'closeprocess' : 'process kill';
      var cmd = 'guestcontrol "' + vm + '" ' + processKillCmd + ' --session-id ' + options.sessionId + ' ' + options.pid;
      vboxmanage(cmd, function(error, stdout) {
        callback(error);
      });
    }
  });

}

function getVboxManageVersion(cb) {
  command(vBoxManageBinary + '--version', cb);
}

function vmExec(options, callback) {
  var vm = options.vm || options.name || options.vmname || options.title,
    username = options.user || options.username || 'Guest',
    password = options.pass || options.passwd || options.password,
    path = options.path || options.cmd || options.command || options.exec || options.execute || options.run,
    cmd,
    params = options.params || options.parameters || options.args;

  if (Array.isArray(params)) {
    params = params.join(" ");
  }

  if (params === undefined) {
    params = "";
  }



  guestproperty.os(vm, getOSTypeCb);

  function getOSTypeCb(os_type) {
    var cmd = 'guestcontrol "' + vm + '"';

    getVboxManageVersion(function(err, version) {

      if(err) {
        callback(err);
        return;
      }

      var major = Number(version.charAt(0));
      var greaterThan5 = !isNaN(major) && major < 5 ? false : true;

      if (os_type === known_OS_types.WINDOWS) {
        path = path.replace(/\\/g, '\\\\');
      }

      if (greaterThan5) {
        cmd += ' start --verbose --exe "' + path + '" --username ' + username + (password ? ' --password ' + password : '') +
        ' -- "' + path + '" "' + params + '"';
      } else {
        cmd += ' execute --image "' + path + '" --username ' + username + (password ? ' --password ' + password : '') + ' -- "' + params + '"';
      }

      logging.info('Executing command "vboxmanage %s" on VM "%s" detected OS type "%s"', cmd, vm, os_type);

      vboxmanage(cmd, function(error, stdout) {
        callback(error, parseExecOutput(stdout));
      });

    });

  }

}

function vmKill(options, callback) {
  options = options || {};
  var vm = options.vm || options.name || options.vmname || options.title,
    path = options.path || options.cmd || options.command || options.exec || options.execute || options.run,
    image_name = options.image_name || path,
    cmd = 'guestcontrol "' + vm + '" process kill';

  guestproperty.os(vm, function(os_type) {
    switch (os_type) {
      case known_OS_types.WINDOWS:
        vmExec({
          vm: vm,
          user: options.user,
          password: options.password,
          path: 'C:\\Windows\\System32\\taskkill.exe /im ',
          params: image_name
        }, callback);
        break;
      case known_OS_types.MAC:
      case known_OS_types.LINUX:
      //@todo
        callback();
        break;
    }
  });

}

var guestproperty = {
  get: function(options, callback) {
    var vm = options.vm || options.name || options.vmname || options.title,
      key = options.key,
      value = options.defaultValue || options.value;

    guestproperty.os(vm, getOSTypeCallback);

    function getOSTypeCallback(os_type) {
      var cmd = 'guestproperty get "' + vm + '" ' + key;
      vboxmanage(cmd, function(error, stdout) {
        if (error) {
          throw error;
        }
        var value = stdout.substr(stdout.indexOf(':') + 1).trim();
        if (value === 'No value set!') {
          value = undefined;
        }

        callback(value);
      });
    }

  },

  os_type: null, // cached

  os: function(vmname, callback) {
    function getOSTypeCallback(error, stdout, stderr) {
      if (error) {
        throw error;
      }

      // The ostype is matched against the ID attribute of 'vboxmanage list ostypes'
      if (stdout.indexOf('ostype="Windows') !== -1) {
        guestproperty.os_type = known_OS_types.WINDOWS;
      } else if (stdout.indexOf('ostype="MacOS') !== -1) {
        guestproperty.os_type = known_OS_types.MAC;
      } else {
        guestproperty.os_type = known_OS_types.LINUX;
      }
      logging.debug('Detected guest OS as: ' + guestproperty.os_type);
      callback(guestproperty.os_type);
    }

    if (guestproperty.os_type) {
      return callback(guestproperty.os_type);
    }

    try {
      exec(vBoxManageBinary + 'showvminfo -machinereadable "' + vmname + '"', getOSTypeCallback);
    } catch (e) {
      logging.info('Could not showvminfo for %s', vmname);
    }
  }

};

module.exports = {
  'exec': vmExec,
  'sessionClose': vmSessionClose,
  'processKill': vmProcessKill,
  'kill': vmKill,
  'list': list,
  'pause': pause,
  'reset': reset,
  'resume': resume,
  'start': start,
  'stop': stop,
  'savestate': savestate,
  'poweroff': poweroff,
  'acpisleepbutton': acpisleepbutton,
  'acpipowerbutton': acpipowerbutton,
  'guestproperty': guestproperty
};
