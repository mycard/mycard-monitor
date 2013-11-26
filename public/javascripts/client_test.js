// Generated by CoffeeScript 1.6.3
(function() {
  this.client_test = function(apps, callback) {
    return $.each(apps, function(index, app) {
      var client, returned, url;
      url = $.url(app.url);
      switch (url.attr('protocol')) {
        case 'http':
        case 'https':
          return $.get(app.url, function(data, textStatus, jqXHR) {
            return callback(app, true, textStatus);
          }).fail(function(error) {
            return callback(app, false, error.statusText);
          });
        case 'ws':
        case 'wss':
          if (window.WebSocket) {
            client = new WebSocket(app.url);
            returned = false;
            client.onclose = function(evt) {
              if (!returned) {
                returned = true;
                return callback(app, false, evt.type);
              }
            };
            client.onerror = function(evt) {
              if (!returned) {
                returned = true;
                return callback(app, false, evt.type);
              }
            };
            if (app.data) {
              client.onmessage = function(evt) {
                if (!returned) {
                  returned = true;
                  return callback(app, true, evt.type);
                }
              };
              return setTimeout(function() {
                if (!returned) {
                  returned = true;
                  return callback(app, true, 'timeout');
                }
              }, 10000);
            } else {
              return client.onopen = function(evt) {
                returned = true;
                return callback(app, true, evt.type);
              };
            }
          } else {
            return callback(app, null, "client not support websocket");
          }
          break;
        default:
          return callback(app, null, "unsupported protocol");
      }
    });
  };

}).call(this);

/*
//@ sourceMappingURL=client_test.map
*/
