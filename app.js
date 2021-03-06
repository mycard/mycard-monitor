// Generated by CoffeeScript 1.6.3
(function() {
  var MongoClient, WebSocketClient, app, dns, express, http, i18n, moment, net, nodemailer, path, request, settings, smtp, url, xmpp, xmpp_client;

  path = require("path");

  url = require('url');

  net = require('net');

  http = require('http');

  express = require("express");

  i18n = require("i18n");

  moment = require('moment-timezone');

  request = require('request');

  nodemailer = require("nodemailer");

  xmpp = require('node-xmpp');

  dns = require('native-dns');

  WebSocketClient = require("websocket").client;

  MongoClient = require('mongodb').MongoClient;

  settings = null;

  try {
    settings = require('./config.json');
  } catch (_error) {
    settings = {
      interval: parseInt(process.env.interval),
      database: process.env.database,
      port: parseInt(process.env.PORT),
      mail: {
        service: process.env.mail_service,
        auth: {
          user: process.env.mail_auth_user,
          pass: process.env.mail_auth_pass
        }
      },
      xmpp: {
        jid: process.env.xmpp_jid,
        password: process.env.xmpp_password
      }
    };
  }

  smtp = nodemailer.createTransport("SMTP", settings.mail);

  xmpp_client = new xmpp.Client(settings.xmpp);

  app = express();

  i18n.configure({
    locales: ['en', 'zh'],
    directory: __dirname + '/locales'
  });

  app.set("port", settings.port);

  app.set("views", path.join(__dirname, "views"));

  app.set("view engine", "hjs");

  app.use(express.favicon());

  app.use(express.logger("dev"));

  app.use(express.json());

  app.use(express.urlencoded());

  app.use(express.methodOverride());

  app.use(i18n.init);

  app.use(app.router);

  app.use(express["static"](path.join(__dirname, "public"), {
    maxAge: 31557600000
  }));

  if ("development" === app.get("env")) {
    app.use(express.errorHandler());
  }

  MongoClient.connect(settings.database, function(err, db) {
    var apps_collection, logs_collection, notice, pages_collection, record, t;
    if (err) {
      throw err;
    }
    apps_collection = db.collection('apps');
    logs_collection = db.collection('logs');
    pages_collection = db.collection('pages');
    notice = function(app, alive, message) {
      var contact, stanza, url_parsed, _i, _len, _ref, _results;
      if (app.contacts) {
        _ref = app.contacts;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          contact = _ref[_i];
          url_parsed = url.parse(contact);
          console.log(url_parsed);
          switch (url_parsed.protocol) {
            case 'mailto:':
              _results.push(smtp.sendMail({
                from: "萌卡监控 <zh99998@gmail.com>",
                to: contact.split(':', 2)[1],
                subject: "" + app.name + " " + (alive ? '' : '不') + "可用",
                text: "" + message,
                html: "" + message
              }));
              break;
            case 'xmpp:':
              stanza = new xmpp.Element('message', {
                to: contact.split(':', 2)[1],
                type: 'chat'
              }).c('body').t("" + app.name + " " + (alive ? '' : '不') + "可用 (" + message + ")");
              _results.push(xmpp_client.send(stanza));
              break;
            default:
              _results.push(void 0);
          }
        }
        return _results;
      }
    };
    record = function(app, alive, message) {
      var date;
      message = message.toString();
      console.log("" + app.name + " " + alive + " " + message);
      if (alive && app.alive && app.retries) {
        apps_collection.update({
          _id: app._id
        }, {
          $set: {
            retries: 0
          }
        }, function(err) {
          if (err) {
            throw err;
          }
        });
      }
      if (alive !== app.alive) {
        date = new Date();
        if (alive) {
          console.log("" + app.name + " up " + message);
          notice(app, alive, message);
          apps_collection.update({
            _id: app._id
          }, {
            $set: {
              alive: alive,
              retries: 0
            }
          }, function(err) {
            if (err) {
              throw err;
            }
          });
          return logs_collection.insert({
            app: app._id,
            alive: alive,
            message: message,
            created_at: date
          }, function(err) {
            if (err) {
              throw err;
            }
          });
        } else if (app.retries >= app.max_retries) {
          console.log("" + app.name + " down " + message);
          notice(app, alive, message);
          apps_collection.update({
            _id: app._id
          }, {
            $set: {
              alive: alive
            }
          }, function(err) {
            if (err) {
              throw err;
            }
          });
          return logs_collection.insert({
            app: app._id,
            alive: alive,
            message: message,
            created_at: date
          }, function(err) {
            if (err) {
              throw err;
            }
          });
        } else {
          console.log("" + app.name + " retry" + app.retries + " " + message);
          return apps_collection.update({
            _id: app._id
          }, {
            $inc: {
              retries: 1
            }
          }, function(err) {
            if (err) {
              throw err;
            }
          });
        }
      }
    };
    t = 0;
    setInterval(function() {
      apps_collection.find({
        $where: "" + t + " % this.interval == 0"
      }).each(function(err, app) {
        var client, dnsquery, key, question, url_parsed, value, _i, _len, _ref, _ref1;
        if (err) {
          throw err;
        }
        if (app) {
          url_parsed = url.parse(app.url);
          switch (url_parsed.protocol) {
            case 'ws:':
            case 'wss:':
              client = new WebSocketClient();
              client.on("connectFailed", function(error) {
                return record(app, false, error);
              });
              client.on("connect", function(connection) {
                var returned;
                if (app.data) {
                  returned = false;
                  connection.on('message', function(message) {
                    if (!returned) {
                      returned = true;
                      record(app, true, message.type);
                      return connection.close();
                    }
                  });
                  connection.on('error', function(error) {
                    if (!returned) {
                      returned = true;
                      return record(app, false, error);
                    }
                  });
                  connection.on('close', function() {
                    if (!returned) {
                      returned = true;
                      return record(app, false, "WebSocket没有返回内容");
                    }
                  });
                  return setTimeout(function() {
                    if (!returned) {
                      returned = true;
                      record(app, false, "WebSocket等待返回内容超时");
                      return connection.close();
                    }
                  }, 10000);
                } else {
                  connection.close();
                  return record(app, true, "WebSocket连接成功");
                }
              });
              return client.connect(app.url);
            case 'http:':
            case 'https:':
              return request({
                url: app.url,
                timeout: 10000,
                strictSSL: true,
                headers: app.headers
              }, function(err, response, body) {
                if (err) {
                  return record(app, false, err);
                } else if (response.statusCode >= 400) {
                  return record(app, false, "HTTP " + response.statusCode + " " + http.STATUS_CODES[response.statusCode]);
                } else {
                  if (app.content instanceof RegExp) {
                    if (body.match(app.content)) {
                      return record(app, true, body);
                    } else {
                      return record(app, false, body);
                    }
                  } else {
                    return record(app, true, "HTTP " + response.statusCode + " " + http.STATUS_CODES[response.statusCode]);
                  }
                }
              });
            case 'xmpp:':
              return null;
            case 'tcp:':
              client = net.connect({
                port: url_parsed.port,
                host: url_parsed.hostname
              }, function() {
                client.end();
                return record(app, true, "TCP连接成功");
              });
              return client.on('error', function(error) {
                return record(app, false, error);
              });
            case 'dns:':
              question = {
                name: url_parsed.pathname.slice(1)
              };
              _ref = url_parsed.query.split('&');
              for (_i = 0, _len = _ref.length; _i < _len; _i++) {
                dnsquery = _ref[_i];
                _ref1 = dnsquery.split('=', 2), key = _ref1[0], value = _ref1[1];
                question[key] = value;
              }
              question = dns.Question(question);
              return dns.lookup(url_parsed.host, 4, function(err, address, family) {
                var req, _ref2;
                if (err) {
                  return record(app, false, "NS " + url_parsed.host + " 解析失败: " + err);
                } else {
                  req = dns.Request({
                    question: question,
                    server: {
                      address: address,
                      port: (_ref2 = url_parsed.port) != null ? _ref2 : 53,
                      type: 'udp'
                    },
                    timeout: 10000
                  });
                  req.on('timeout', function() {
                    return record(app, false, "DNS 请求超时");
                  });
                  req.on('message', function(err, answer) {
                    var ans, _ref3, _ref4;
                    if (err) {
                      return record(app, false, err);
                    } else if (answer.answer.length) {
                      ans = answer.answer[0];
                      return record(app, true, (_ref3 = (_ref4 = ans.address) != null ? _ref4 : ans.data) != null ? _ref3 : JSON.stringify(ans));
                    } else {
                      return record(app, false, "DNS 查询结果为空");
                    }
                  });
                  return req.send();
                }
              });
            default:
              throw "unsupported procotol " + app.url;
          }
        }
      });
      return t++;
    }, settings.interval);
    app.get("/", function(req, res) {
      return pages_collection.findOne({
        domain: req.headers.host
      }, function(err, page) {
        var apps;
        if (err) {
          throw err;
        }
        if (page) {
          res.header('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
          return apps = apps_collection.find({
            _id: {
              $in: page.apps
            }
          }).toArray(function(err, apps) {
            var logs;
            if (err) {
              throw err;
            }
            return logs = logs_collection.find({
              app: {
                $in: page.apps
              }
            }).sort({
              created_at: -1
            }).limit(10).toArray(function(err, logs) {
              var alive, log, uptime_humane, _i, _j, _k, _len, _len1, _len2;
              if (err) {
                throw err;
              }
              alive = true;
              for (_i = 0, _len = apps.length; _i < _len; _i++) {
                app = apps[_i];
                if (!app.alive) {
                  alive = false;
                  break;
                }
              }
              if (alive) {
                uptime_humane = moment(logs[0].created_at).lang('zh-cn').fromNow(true);
              } else {

              }
              for (_j = 0, _len1 = logs.length; _j < _len1; _j++) {
                log = logs[_j];
                log.created_at_humane = moment(log.created_at).tz("Asia/Shanghai").lang('zh-cn').format('YYYY-MM-DD HH:mm (Z)');
                for (_k = 0, _len2 = apps.length; _k < _len2; _k++) {
                  app = apps[_k];
                  if (app._id.equals(log.app)) {
                    log.app = app;
                    break;
                  }
                }
              }
              if (page.client_test && page.client_test.length) {
                return apps_collection.find({
                  _id: {
                    $in: page.client_test
                  }
                }).toArray(function(err, client_test) {
                  var client_test_json;
                  client_test_json = JSON.stringify(client_test);
                  return res.render('page', {
                    page: page,
                    apps: apps,
                    logs: logs,
                    alive: alive,
                    client_test: client_test,
                    client_test_json: client_test_json,
                    uptime_humane: uptime_humane,
                    locale: res.getLocale(),
                    __: function() {
                      return res.__;
                    }
                  });
                });
              } else {
                return res.render('page', {
                  page: page,
                  apps: apps,
                  logs: logs,
                  alive: alive,
                  uptime_humane: uptime_humane,
                  locale: res.getLocale(),
                  __: function() {
                    return res.__;
                  }
                });
              }
            });
          });
        } else {
          return res.render('index', {
            locale: res.getLocale(),
            __: function() {
              return res.__;
            }
          });
        }
      });
    });
    app.get("/favicon.ico", function(req, res) {
      return pages_collection.findOne({
        domain: req.headers.host
      }, function(err, page) {
        if (err) {
          throw err;
        }
        if (page && page.favicon) {
          return res.redirect(301, page.favicon);
        } else {
          return res.redirect(301, "https://my-card.in/favicon.ico");
        }
      });
    });
    return http.createServer(app).listen(app.get("port"), function() {
      return console.log("Express server listening on port " + app.get("port"));
    });
  });

}).call(this);

/*
//@ sourceMappingURL=app.map
*/
