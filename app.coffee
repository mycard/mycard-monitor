#标准库
path = require "path"
url = require 'url'
net = require 'net'
http = require 'http'

#三方库
express = require "express"
request = require 'request'
nodemailer = require "nodemailer"
xmpp = require 'node-xmpp'
dns = require 'native-dns'
WebSocketClient = require("websocket").client
MongoClient = require('mongodb').MongoClient

#本地
settings = null
try
  settings = require './config.json'
catch
  settings = {
    interval: parseInt process.env.interval
    database: process.env.database
    port: parseInt process.env.PORT
    mail: {
      service: process.env.mail_service
      auth: {
        user: process.env.mail_auth_user
        pass: process.env.mail_auth_pass
      }
    }
    xmpp: {
      jid: process.env.xmpp_jid
      password: process.env.xmpp_password
    }
  }

smtp = nodemailer.createTransport "SMTP",settings.mail
xmpp_client = new xmpp.Client(settings.xmpp)
app = express()

# all environments
app.set "port", settings.port
app.set "views", path.join(__dirname, "views")
app.set "view engine", "hjs"
app.use express.favicon()
app.use express.logger("dev")
app.use express.json()
app.use express.urlencoded()
app.use express.methodOverride()
app.use app.router
app.use express.static(path.join(__dirname, "public"))

# development only
app.use express.errorHandler()  if "development" is app.get("env")

#TODO: 拆分文件
MongoClient.connect settings.database, (err, db)->
  throw err if err

  apps_collection = db.collection('apps')
  logs_collection = db.collection('logs')
  pages_collection = db.collection('pages')

  #监控记录
  record = (app, alive, message)->
    message = message.toString()
    console.log "#{app.name} #{alive} #{message}"

    #存活，清空重试次数
    if alive and app.alive and app.retries
      apps_collection.update {_id:app._id}, {$set:{retries:0}}, (err)->
        throw err if err

    #存活状态变更
    if alive != app.alive
      date = new Date()

      if alive #上线
        console.log "#{app.name} up #{message}"
        #邮件通知
        smtp.sendMail
          from: "萌卡监控 <zh99998@gmail.com>"
          to: "zh99998@gmail.com",
          subject: "#{app.name} 恢复可用 (#{message})"
          text: "#{message}"
          html: "#{message}"

        #xmpp通知
        stanza = new xmpp.Element('message',{ to: 'zh99998@gmail.com', type: 'chat' }).c('body').t(
          "#{app.name} 恢复可用 (#{message})"
        )
        xmpp_client.send(stanza)

        apps_collection.update {_id:app._id}, {$set:{alive:alive, retries:0}}, (err)->
          throw err if err
        logs_collection.insert {app: app._id, alive: alive, message: message, created_at: date}, (err)->
          throw err if err

      else if app.retries >= 5 #下线
        console.log "#{app.name} down #{message}"

        #邮件通知
        smtp.sendMail
          from: "萌卡监控 <zh99998@gmail.com>"
          to: "zh99998@gmail.com",
          subject: "#{app.name} 不可用 (#{message})"
          text: "#{message}"
          html: "#{message}"

        #xmpp通知
        stanza = new xmpp.Element('message',{ to: 'zh99998@gmail.com', type: 'chat' }).c('body').t(
          "#{app.name} 不可用 (#{message})"
        )
        xmpp_client.send(stanza)

        apps_collection.update {_id:app._id}, {$set:{alive:alive}}, (err)->
          throw err if err
        logs_collection.insert {app: app._id, alive: alive, message: message, created_at: date}, (err)->
          throw err if err

      else #重试
        console.log "#{app.name} retry#{app.retries} #{message}"
        apps_collection.update {_id:app._id}, {$inc:{retries:1}}, (err)->
          throw err if err


  #监控逻辑
  setInterval ->
    apps_collection.find().each (err, app)->
      throw err if err
      if app
        url_parsed = url.parse app.url
        switch url_parsed.protocol
          when 'ws:', 'wss:'
            client = new WebSocketClient()
            client.on "connectFailed", (error) ->
              record(app, false, error)

            client.on "connect", (connection) ->
              connection.close()
              record(app, true, "WebSocket连接成功")

            client.connect app.url
          when 'http:', 'https:'
            request
              url: app.url
              timeout: 10000
              strictSSL: true
              headers: app.headers
            , (err, response, body)->
              if err #http失败
                record(app, false, err)
              else if response.statusCode >= 400 #http成功，但返回了4xx或5xx
                record(app, false, "HTTP #{response.statusCode} #{http.STATUS_CODES[response.statusCode]}")
              else #ok
                record(app, true, "HTTP #{response.statusCode} #{http.STATUS_CODES[response.statusCode]}")
          when 'xmpp:'
          #client = new xmpp.Client()
          #client.on 'error', (error)->
          #  console.error(error)
            null
          when 'tcp:'
            client = net.connect port:url_parsed.port, host:url_parsed.hostname, ->
              client.end()
              record(app, true, "TCP连接成功")
            client.on 'error', (error)->
              record(app, false, error)
          when 'dns:'
            question = dns.Question
              name: url_parsed.pathname.slice(1)
            for dnsquery in url_parsed.query.split('&')
              [key, value] = dnsquery.split('=', 2)
              question[key] = value

            dns.lookup url_parsed.host, 4, (err, address, family)->
              if err
                record(app, false, "NS #{url_parsed.host} 解析失败: #{err}")
              else
                req = dns.Request({
                  question: question,
                  server: { address: address, port: url_parsed.port ? 53, type: 'udp' },
                  timeout: 10000,
                });
                req.on 'timeout', ()->
                  record(app, false, "DNS 请求超时")

                req.on 'message', (err, answer)->
                  if answer.answer.length
                    record(app, true, answer.answer[0].data)
                  else
                    record(app, false, "DNS 查询结果为空")

                req.send()
          else
            throw "unsupported procotol #{app.url}"

  , settings.interval

  #网站逻辑

  app.get "/", (req, res)->
    pages_collection.findOne domain: req.headers.host, (err, page)->
      throw err if err
      if page
        apps = apps_collection.find(_id: {$in: page.apps}).toArray (err, apps)->
          throw err if err
          logs = logs_collection.find(app: {$in: page.apps}).sort({created_at: -1}).limit(10).toArray (err, logs)->
            throw err if err
            alive = true
            for app in apps
              if !app.alive
                alive = false
                break
            for log in logs
              log.created_at_humane = log.created_at.toLocaleString()
              for app in apps
                if app._id.equals log.app
                  log.app = app
                  break
            res.render 'page', { page: page, apps: apps, logs: logs, alive: alive}
      else
        res.render 'index', { title: 'mycard-monitor' }

  http.createServer(app).listen app.get("port"), ->
    console.log "Express server listening on port " + app.get("port")