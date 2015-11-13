/*
 * GitHub social provider
 */
var PUBLIC_GIST_DESCRIPTION = 'freedom_public';
var HEARTBEAT_GIST_DESCRIPTION = 'freedom_hearbeat';
var ETAGS_STORAGE_KEY = 'etags';
var TIMESTAMPS_STORAGE_KEY = 'timestamps';

var MESSAGE_TYPES = {
  INVITE: 0,
  ACCEPT_INVITE: 1,
  HEARTBEAT: 2,
  MESSAGE: 3,
  STORAGE: 4
};

var STATUS = {
  FRIEND: 0,
  INVITED_BY_USER: 1,
  USER_INVITED: 2
};

var GithubSocialProvider = function(dispatchEvent) {
  this.dispatchEvent_ = dispatchEvent;
  this.networkName_ = 'github';

  this.gists = [];
  this.userProfiles = {};
  this.myClientState_ = {};
  this.clientStates_ = {};

  this.initLogger_('GithubSocialProvider');
  this.storage = freedom['core.storage']();
  this.access_token = '';
  this.users_ = {};
  this.myHeartbeatGist_ = '';
  this.myPublicGist_ = '';
  this.lastSeenTime_ = 0; //Date.now();
  this.eTags_ = {};
  this.lastUpdatedTimestamp_ = {};
  this.storage_ = freedom['core.storage']();
  this.readFromLocalstorage_ = false;
};

function arrayBufferToString(buffer) {
  var bytes = new Uint8Array(buffer);
  var a = [];
  for (var i = 0; i < bytes.length; ++i) {
    a.push(String.fromCharCode(bytes[i]));
  }
  return a.join('');
}

function stringToArrayBuffer(s) {
  var buffer = new ArrayBuffer(s.length);
  var bytes = new Uint8Array(buffer);
  for (var i = 0; i < s.length; ++i) {
    bytes[i] = s.charCodeAt(i);
  }
  return buffer;
}

/*
 * Initialize this.logger using the module name.
 */
GithubSocialProvider.prototype.initLogger_ = function(moduleName) {
  this.logger = console;  // Initialize to console if it exists.
  if (typeof freedom !== 'undefined' &&
      typeof freedom.core === 'function') {
    freedom.core().getLogger('[' + moduleName + ']').then(function(log) {
      this.logger = log;
    }.bind(this));
  }
};

// TODO(ldixon): We cannot use OAuth flow with the client secret for a non-web
// app (i.e. in uProxy). See https://developer.github.com/v3/oauth/#non-web-
// application-flow for the right way to do this.  If we include the client
// secret, as bellow, then the client secret is public and we open ourselves up
// to abuse and to abuse.

/*
 * Login to social network, returns a Promise that fulfills on login.
 */
GithubSocialProvider.prototype.login = function(loginOpts) {
  return new Promise(function(fulfillLogin, rejectLogin) {
    var OAUTH_REDIRECT_URLS = [
      "https://www.uproxy.org/oauth-redirect-uri",
      "http://freedomjs.org/",
      "http://localhost:8080/",
      "https://fmdppkkepalnkeommjadgbhiohihdhii.chromiumapp.org/"
    ];
    var OAUTH_CLIENT_ID = '98d31e7ceefe0518a093';
    var oauth = freedom["core.oauth"]();

    oauth.initiateOAuth(OAUTH_REDIRECT_URLS).then(function(stateObj) {
      var url ='https://github.com/login/oauth/authorize?client_id=98d31e7ceefe0518a093&scope=gist';
      return oauth.launchAuthFlow(url, stateObj).then(function(responseUrl) {
        return responseUrl.match(/code=([^&]+)/)[1];
      });
    }).then(function(code) {
      var xhr = freedom["core.xhr"]();
      xhr.open('POST', 'https://github.com/login/oauth/access_token?code=' + code +
                '&client_id=98d31e7ceefe0518a093' +
                '&client_secret=f77bf1477d4ade44d2dff674e2ff742ed540b3a1', true);
      xhr.on('onload', function() {
        xhr.getResponseText().then(function(text) {
          this.access_token = text.match(/access_token=([^&]+)/)[1];
          xhr = new freedom["core.xhr"]();
          xhr.open('GET', 'https://api.github.com/user?access_token=' + this.access_token, true);
          xhr.on('onload', function() {
            xhr.getResponseText().then(function(text) {
              var user = JSON.parse(text);
              this.prepareClientId_().then(function(clientId) {
                var clientState = {
                  userId: user.login,
                  clientId: clientId,
                  status: "ONLINE",
                  lastUpdated: Date.now(),
                  lastSeen: Date.now()
                };

                this.myClientState_ = clientState;
                // If the user does not yet have a public uProxy gist, create one.

                fulfillLogin(clientState);
                //this.loadContacts_();

                var profile = {
                  userId: user.login,
                  name: user.name,
                  lastUpdated: Date.now(),
                  url: user.html_url,
                  imageData: user.avatar_url
                };
                this.addUserProfile_(profile);
                this.finishLogin_();
              }.bind(this));
            }.bind(this));
          }.bind(this));
          xhr.send();
        }.bind(this));
      }.bind(this));
      xhr.send();
    }.bind(this));
  }.bind(this));  // end of return new Promise
};

GithubSocialProvider.prototype.prepareClientId_ = function() {
  return new Promise(function(fulfill, reject) {
    this.storage_.get('clientId').then(function(clientId) {
      if (typeof clientId !== 'undefined' && clientId !== null) {
        fulfill(clientId);
      } else {
        clientId = Math.random().toString();
        this.storage_.set('clientId', clientId);
        fulfill(clientId);
      }
    }.bind(this));
  }.bind(this));
};

/*
 * Check if this user already has a public uProxy gist with their public
 * key in it.
 */
GithubSocialProvider.prototype.checkForGist_ = function(userId, description) {
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/users/' + userId + '/gists';
  xhr.open('GET', url);
  xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
  xhr.setRequestHeader("If-Modified-Since", "Sat, 2 Jan 2005 00:00:00 GMT");
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      var gists = JSON.parse(xhr.response);
      for (var i = 0; i < gists.length; i++) {
        if (gists[i].description ===  description) {
          return fulfill(gists[i].id);
        }
      }
      return fulfill('');
    }.bind(this);
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.createGist_ = function(description, isPublic, content) {
  return this.checkForGist_(this.myClientState_.userId, description)
    .then(function(gistId) {
      if (gistId === '') {
        var xhr = new XMLHttpRequest();
        var url = 'https://api.github.com/gists';
        xhr.open('POST', url);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
        return new Promise(function(fulfill, reject) {
          // TODO: error checking
          xhr.onload = function() {
            //console.log(xhr.responseText);
            fulfill(JSON.parse(xhr.responseText).id);
          };
          xhr.send(JSON.stringify({
            "description": description,
            "public": isPublic,
            "files": {
              'file': {
                "content": content
              }
            }
          }));
        }.bind(this));
      } else {
        return Promise.resolve(gistId);
      }
  }.bind(this));
};

/*
 * Loads contacts of the logged in user, and calls this.addUserProfile_
 * and this.updateUserProfile_ (if needed later, e.g. for async image
 *'https://api.github.com/gists/' + gistId fetching) for each contact.
 */
GithubSocialProvider.prototype.loadContacts_ = function() {
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/users/' + this.myClientState_.userId + '/followers';
  xhr.open('GET', url);
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      var followers = JSON.parse(xhr.response);
    }.bind(this);
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.postComment_ = function(gistId, messageType, comment, toClient) {
  return new Promise(function(fulfill, reject) {
    var xhr = freedom["core.xhr"]();
    var url = 'https://api.github.com/gists/' + gistId + '/comments';
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
    xhr.on('onload', function() {
      xhr.getStatus().then(function(status) {
        if (status === 201) {
          xhr.getResponseText().then(function(text) {
            var comment = JSON.parse(text);
            fulfill(comment.url);
          });
        } else {
          reject();
        }
      }.bind(this));
    }.bind(this));
    var message = {
      clientId: this.myClientState_.clientId,
      messageType: messageType,
      toClient: toClient,
      message: comment
    };
    xhr.send({string: JSON.stringify({
      "body" : JSON.stringify(message)
    })});
  }.bind(this));
};

/*
 * Get given gist.
 * @param gist    url with form https://api.github.com/gists/:id
 */
GithubSocialProvider.prototype.pullGist_ = function(gistId, from, page) {
  return new Promise(function(fulfill, reject) {
    if (typeof page === 'undefined') {
      page = 1;
    }

    if (typeof this.lastUpdatedTimestamp_[gistId] === 'undefined') {
      this.lastUpdatedTimestamp_[gistId] = 0;
    }

    var xhr = freedom["core.xhr"]();
    var url = 'https://api.github.com/gists/' + gistId + '/comments?page=' + page;
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
    if (gistId in this.eTags_) {
      xhr.setRequestHeader("If-None-Match", this.eTags_[gistId]); //"Sat, 1 Jan 2005 00:00:00 GMT");
    }
    xhr.setRequestHeader("If-Modified-Since", "Sat, 1 Jan 2005 00:00:00 GMT");
    xhr.on('onload', function() {
      xhr.getResponseHeader('ETag').then(function(ETag) {
        this.eTags_[gistId] = ETag;
      }.bind(this));

      xhr.getStatus().then(function(status) {
        //console.log(status);
        if (status === 304) {
          fulfill([]);
          return;
        }
        if (status === 200) {
          xhr.getResponseText().then(function(responseText) {
            var comments = JSON.parse(responseText);
            var new_comments = [];
            var last_updated = 0;
            for (var i in comments) {
              var updated_at = Date.parse(comments[i].updated_at);
              if (updated_at > this.lastUpdatedTimestamp_[gistId]) {
                var comment = {
                  from: comments[i].user.login,
                  body: comments[i].body,
                  url: comments[i].url
                };

                if (this.isValidMessage_(comment, from)) {
                  new_comments.push(comment);
                }
              }

              if (updated_at > last_updated) {
                last_updated = updated_at;
              }
            }
            if (last_updated > this.lastUpdatedTimestamp_[gistId]) {
              this.lastUpdatedTimestamp_[gistId] = last_updated;
            }
            if (comments.length === 30) {
              this.pullGist_(gistId, from, page+1).then(function(other_comments) {
                fulfill(new_comments.concat(other_comments));
              });
            } else {
              fulfill(new_comments);
            }
            this.saveToLocalStorage_();
          }.bind(this));
        } else {
          reject();
        }
      }.bind(this));
    }.bind(this));
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.getUserProfile_ = function(userId) {
  return new Promise(function(fulfill, reject) {
    var xhr = freedom["core.xhr"]();
    xhr.open('GET', 'https://api.github.com/users/' + userId + '?access_token=' + this.access_token, true);
    xhr.on('onload', function() {
      xhr.getResponseText().then(function(text) {
        var user = JSON.parse(text);
        //console.log(user);
        var profile = {
          userId: user.login,
          name: user.nameGist,
          lastUpdated: Date.now(),
          url: user.html_url,
          imageData: user.avatar_url,
        };
        fulfill(this.addUserProfile_(profile));
      }.bind(this));
    }.bind(this));
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.restoreFromStorage_ = function() {
  return new Promise(function(fulfill, reject) {
    this.createGist_('storage', false, "storage").then(function(gistId) {
      this.pullGist_(gistId, this.myClientState_.userId).then(function(comments) {
        switch (comments.length) {
          case 0:
            this.postComment_(gistId, MESSAGE_TYPES.STORAGE, this.users_).then(function(url) {
              this.myStorageGist_ = url;
            }.bind(this));
            break;
          case 1:
            try {
              var body = JSON.parse(comments[0].body);
              this.users_ = body.message;
              this.myStorageGist_ = comments[0].url;
            } catch (e) {
              console.error(e);
            }
            break;
          default: console.error("no good");
        }
        fulfill();
      }.bind(this));
    }.bind(this));
  }.bind(this));
};

GithubSocialProvider.prototype.modifyGistContent_ = function(gistId, content) {
  var xhr = freedom["core.xhr"]();
  xhr.open('PATCH', 'https://api.github.com/gists/' + gistId, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
  xhr.on('onload', function() {
    xhr.getResponseText().then(function(responseText) {
      //console.log(responseText);
    });
    xhr.getStatus().then(function(status) {
      //console.log(status);
    });
  });
  xhr.send({string: JSON.stringify({
    "description": PUBLIC_GIST_DESCRIPTION, // TODO change it
    "files": {
      'file': {
        //'filename': 'new_file',
        "content": content
      }
    }
  })});

};
GithubSocialProvider.prototype.finishLogin_ = function() {
  this.pgp_ = new freedom['pgp-e2e']();
  this.pgp_.setup('', '<github>').then(function() {
    this.pgp_.exportKey().then(function(key) {
      this.publicKey_ = key.key;
      // recovers when app is deleted and reinstalled
      this.checkForGist_(this.myClientState_.userId, PUBLIC_GIST_DESCRIPTION).then(function(gistId) {
        var myClientId = this.myClientState_.clientId;
        if (gistId !== '') {
          this.myPublicGist_ = gistId;
          this.getContent_(gistId).then(function(keys) {
            if (myClientId in keys || keys[myClientId] !== this.publicKey_) {
              keys[myClientId] = this.publicKey_;
              this.modifyGistContent_(gistId, JSON.stringify(keys));
            }
          }.bind(this));
        } else {
          var keys = {};
          keys[myClientId] = this.publicKey_;
          var content = JSON.stringify(keys);
          this.createGist_(PUBLIC_GIST_DESCRIPTION, true, content).then(function(gistId) {
            this.myPublicGist_ = gistId;
          }.bind(this));
        }
      }.bind(this));
    }.bind(this));
  }.bind(this));
  this.createGist_(HEARTBEAT_GIST_DESCRIPTION, false, "heartbeat").then(function(gistId) {
    this.heartbeatGist_ = gistId;
    this.pullGist_(gistId, this.myClientState_.userId).then(function(heartbeats) {
      for (var i in heartbeats) {
        var comment = JSON.parse(heartbeats[i].body);
        if(comment.messageType === MESSAGE_TYPES.HEARTBEAT &&
           comment.clientId === this.myClientState_.clientId) {
          this.myHeartbeatGist_ = heartbeats[i].url;
          break;
        }
      }

      if (this.myHeartbeatGist_ === '') {
        this.postComment_(gistId,
                          MESSAGE_TYPES.HEARTBEAT,
                          {date: Date.now()}).then(function(gistUrl) {
            this.myHeartbeatGist_ = gistUrl;
        }.bind(this));
      }
    }.bind(this)).catch(function(E) {
      console.error(e);
    });
  }.bind(this));
  this.readFromLocalStorage_().then(function() {
    this.heartbeat_(); /// XXX this is a hack
    this.heartbeatIntervalId_ = setInterval(this.heartbeat_.bind(this), 10000); // 10 secs for now
    this.messagePullingIntervalId_ = setInterval(this.pullMessages_.bind(this), 1000); // 1 sec
  }.bind(this));
};

GithubSocialProvider.prototype.readFromLocalStorage_ = function() {
  var promises = [];
  promises.push(new Promise(function(fulfill, reject) {
    this.storage_.get(ETAGS_STORAGE_KEY).then(function(result) {
      try {
        this.eTags_ = JSON.parse(result);
      } catch (e) {
        this.eTags_ = {};
      }

      if (result === null) {
        this.eTags_ = {};
      }
      fulfill();
    }.bind(this));
  }.bind(this)));

  promises.push(new Promise(function(fulfill, reject) {
    this.storage_.get(TIMESTAMPS_STORAGE_KEY).then(function(result) {
      try {
        this.lastUpdatedTimestamp_ = JSON.parse(result);
      } catch (e) {
        this.lastUpdatedTimestamp_ = {};
      }

      if (result === null) {
        this.lastUpdatedTimestamp_ = {};
      }
      fulfill();
    }.bind(this));
  }.bind(this)));

  promises.push(new Promise(function(fulfill, reject) {
    this.storage_.get('users').then(function(result) {
      try {
        this.users_ = JSON.parse(result);
      } catch (e) {
        this.users_ = {};
      }

      if (result === null) {
        this.users_ = {};
      }
      fulfill();
    }.bind(this));
  }.bind(this)));


  return Promise.all(promises);
};


GithubSocialProvider.prototype.saveToLocalStorage_ = function() {
  // Do we need to return promise?
  this.storage_.set(ETAGS_STORAGE_KEY, JSON.stringify(this.eTags_));
  this.storage_.set(TIMESTAMPS_STORAGE_KEY, JSON.stringify(this.lastUpdatedTimestamp_));
};

GithubSocialProvider.prototype.parseHeartbeat_ = function(userId, heartbeats) {
  var onlineClients = {};
  for (var i in heartbeats) {
    try {
      var comment = JSON.parse(heartbeats[i].body);
      if (comment.messageType !== MESSAGE_TYPES.HEARTBEAT) {
        console.error('not a heartbeat');
        continue;
      }
      onlineClients[comment.clientId] = true;
      this.addOrUpdateClient_(userId, comment.clientId, 'ONLINE');
    } catch (e) {
      continue;
    }
  }

  for (var clientId in this.clientStates_) {
    if (this.clientStates_[clientId].userId === userId &&
        typeof onlineClients[clientId] === 'undefined' &&
        clientId !== this.myClientState_.clientId) {
      this.addOrUpdateClient_(userId, clientId, 'OFFLINE');
    }
  }
};

GithubSocialProvider.prototype.isValidMessage_ = function(comment, from) {
  var message;
  try {
    message = JSON.parse(comment.body);
  } catch (e) {
    return false;
  }
  if (typeof message.messageType === 'undefined' ||
      typeof message.clientId === 'undefined') {
    console.error('malformed message', message);
    // XXX return false;
    return false;
  }

  if (typeof from !== 'undefined' && from !== comment.from) {
    // Message is not who I expect it to be from;
    // This is possible, so not an error, but still drop it.
    return false;
  }

  if (message.messageType == MESSAGE_TYPES.MESSAGE) {
    // If it's a message on signaling channel
    //
    if (typeof message.toClient === 'undefined') {
      console.error('malformed message', message);
      return false;
    }
    if (message.toClient !== this.myClientState_.clientId) {
      return false;
    }

  }
  if (message.clientId !== this.myClientState_.clientId &&
      message.messageType == MESSAGE_TYPES.STORAGE) {
    return false;
  }

  // Discard old heartbeats.
  // This can happen when you log in and you see
  // your friends heartbeats between last time you check it
  // and now but it shouldn't count because it's old.
  if (message.messageType == MESSAGE_TYPES.HEARTBEAT) {
    if (message.message.date < Date.now() - 20000) {
      return false;
    }
  }

  return true;
};

GithubSocialProvider.prototype.parseMessages_ = function(messages, from) {
  for (var i in messages) {
    var comment = JSON.parse(messages[i].body);

    if (comment.messageType === MESSAGE_TYPES.ACCEPT_INVITE) {
      this.users_[messages[i].from].heartbeat = comment.message.heartbeat;
      this.updateUserStatus_(messages[i].from, STATUS.FRIEND);
      this.saveToStorage_();
      /// XXX raise an event
      continue;
    }

    var clientState = {
      userId: messages[i].from,
      clientId: comment.clientId,
      status: 'ONLINE',
      lastUpdated: Date.now(),
      lastSeen: Date.now()
    };

    this.addOrUpdateClient_(messages[i].from, comment.clientId, 'ONLINE');

    this.handleMessage_(clientState, comment.message);
  }
};


GithubSocialProvider.prototype.modifyComment_ = function(commentUrl, body) {
  if (typeof commentUrl === 'undefined' ||
      commentUrl === '') {
    return;
  }
  var xhr = freedom["core.xhr"]();
  xhr.open('PATCH', commentUrl, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
  xhr.on('onload', function() {
    xhr.getResponseText().then(function(responseText) {
      //console.log(responseText);
    });
    xhr.getStatus().then(function(status) {
      //console.log(status);
    });
  });
  xhr.send({string: JSON.stringify({
    "body": JSON.stringify(body)
  })});
};

GithubSocialProvider.prototype.saveToStorage_ = function() {
  this.storage_.set('users', JSON.stringify(this.users_));
  /*
  this.modifyComment_(this.myStorageGist_,
                      {clientId: this.myClientState_.clientId,
                       messageType: MESSAGE_TYPES.STORAGE,
                       message: this.users_});
  */
};

GithubSocialProvider.prototype.handleInvite_ = function(from, comment) {
  return this.getUserProfile_(from).then(function(profile) {
    return this.checkForGist_(from, PUBLIC_GIST_DESCRIPTION).then(function(friendGist) {
      return this.getContent_(friendGist);
    }.bind(this)).then(function(keys) {
      var key = keys[comment.clientId];
      return this.pgp_.dearmor(comment.message).then(function(cipherData) {
        return this.pgp_.verifyDecrypt(cipherData, key);
      }.bind(this)).then(function(result) {
        var message = JSON.parse(arrayBufferToString(result.data));
        profile.heartbeat = message.heartbeat;
        profile.signaling = message.signaling;
        this.updateUserStatus_(from, STATUS.INVITED_BY_USER);
        this.saveToStorage_();
      }.bind(this));
    }.bind(this));
  }.bind(this));
};

GithubSocialProvider.prototype.pullMessages_ = function() {
  if (this.myPublicGist_ !== '') {
    this.pullGist_(this.myPublicGist_).then(function(comments) {
      for (var i in comments) {
        var comment;
        try {
          comment = JSON.parse(comments[i].body);
          if (comment.messageType === MESSAGE_TYPES.INVITE) {
            this.handleInvite_(comments[i].from, comment);
          }
        } catch (e) {
          console.error('error parsing ', e);
        }

        this.deleteComment_(comments[i].url);
      }
    }.bind(this));
  }

  for (var user in this.users_) {
    if (typeof this.users_[user].signaling !== 'undefined') {
      this.pullGist_(this.users_[user].signaling, user).then(this.parseMessages_.bind(this));
    }
  }
};

GithubSocialProvider.prototype.deleteComment_ = function(commentUrl) {
  var xhr = freedom["core.xhr"]();
  xhr.open('DELETE', commentUrl, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
  xhr.on('onload', function() {
    xhr.getStatus().then(function(status) {
      //console.log(status);
    });
  });
  xhr.send();
};

GithubSocialProvider.prototype.heartbeat_ = function() {
  this.modifyComment_(this.myHeartbeatGist_,
                      {clientId: this.myClientState_.clientId,
                       messageType: MESSAGE_TYPES.HEARTBEAT,
                       message: {
                        date: Date.now()
                      }});
  for (var user in this.users_) {
    if (typeof this.users_[user].heartbeat !== 'undefined' &&
        this.users_[user].status === STATUS.FRIEND) {
      var heart = this.users_[user].heartbeat;
      this.pullGist_(heart, user).then(this.parseHeartbeat_.bind(this, user));
    }
  }
};
GithubSocialProvider.prototype.getContent_ = function(gistId) {
  return new Promise(function(fulfill, reject) {
    var xhr = freedom["core.xhr"]();
    xhr.open('GET', 'https://api.github.com/gists/' + gistId, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', 'token ' + this.access_token);
    xhr.on('onload', function() {
      xhr.getResponseText().then(function(text) {
        var gist = JSON.parse(text);
        fulfill(JSON.parse(gist.files.file.content));
        //console.log(status);
      });
    });
    xhr.send();
  }.bind(this));
};

GithubSocialProvider.prototype.encryptAndPost_ = function(gistId, message, key, clientId) {
  var arrayBuf = stringToArrayBuffer(JSON.stringify(message));
  return this.pgp_.signEncrypt(arrayBuf, key).then(function(cipherData) {
    return this.pgp_.armor(cipherData);
  }.bind(this)).then(function(cipherText) {
    return this.postComment_(gistId,
                             MESSAGE_TYPES.INVITE,
                             cipherText,
                             clientId);
  }.bind(this)).catch(function(e) {
    console.error(e);
  });
};

GithubSocialProvider.prototype.inviteUser = function(userId) {
  return this.checkForGist_(userId, PUBLIC_GIST_DESCRIPTION).then(function(friendGist) {
    if (friendGist === '') {
      return Promise.reject('Not a uproxy user');
    }
    return this.createGist_('signaling:' + userId, false, "signaling").then(function(signalingGist) {
      return this.getUserProfile_(userId).then(function(profile) {
        this.updateUserStatus_(userId, STATUS.USER_INVITED);
        profile.signaling = signalingGist;
        this.saveToStorage_();
        return this.getContent_(friendGist).then(function(keys) {
          var promises = [];
          for (var clientId in keys) {
            var message = {
              heartbeat :this.heartbeatGist_,
              signaling: signalingGist
            };

            var key = keys[clientId];
            promises.push(this.encryptAndPost_(friendGist, message, key, clientId));
          }

          return Promise.all(promises);
        }.bind(this));
      }.bind(this));
    }.bind(this));
  }.bind(this));
};

GithubSocialProvider.prototype.acceptUserInvitation = function(userId) {
  var signalingGist = this.users_[userId].signaling;
  if (typeof signalingGist === 'undefined') {
    return Promise.reject('No invite from this user');
  }
  this.updateUserStatus_(userId, STATUS.FRIEND);
  this.saveToStorage_();

  return this.postComment_(signalingGist,
                           MESSAGE_TYPES.ACCEPT_INVITE,
                           {heartbeat :this.heartbeatGist_});
};
/*
 * Returns a Promise which fulfills with all known ClientStates.
 */
GithubSocialProvider.prototype.getClients = function() {
  return Promise.resolve({});
};

/*
 * Returns a Promise which fulfills with all known UserProfiles
 */
GithubSocialProvider.prototype.getUsers = function() {
  return Promise.resolve({});
};

/*
 * Sends a message to another clientId.
 */
GithubSocialProvider.prototype.sendMessage = function(toClientId, message) {
  if (this.clientStates_[toClientId].status !== 'ONLINE') {
    return Promise.reject('Client not online');
  }

  var userId = this.clientStates_[toClientId].userId;
  var signalingGist = this.users_[userId].signaling;
  return this.postComment_(signalingGist, MESSAGE_TYPES.MESSAGE, message, toClientId)
      .then( Promise.resolve();
};

/*
 * Logs out of the social network.
 */
GithubSocialProvider.prototype.logout = function() {
  clearInterval(this.heartbeatIntervalId_);
  clearInterval(this.messagePullingIntervalId_);
  return Promise.resolve();
};


/*
 * Adds a UserProfile.
 */
GithubSocialProvider.prototype.addUserProfile_ = function(profile) {
  var userProfile = {
    userId: profile.userId,
    name: profile.name || profile.userId || '',
    lastUpdated: Date.now(),
    url: profile.url || '',
    imageData: profile.imageData || ''
  };
  this.dispatchEvent_('onUserProfile', userProfile);
  this.users_[profile.userId] = profile;
  return profile;
};

GithubSocialProvider.prototype.updateUserStatus_ = function(userId, status) {
  profile = this.users_[userId];
  profile.status = status;
  var userProfile = {
    userId: profile.userId,
    name: profile.name || profile.userId || '',
    lastUpdated: Date.now(),
    url: profile.url || '',
    imageData: profile.imageData || '',
    status: profile.status
  };
  this.dispatchEvent_('onUserProfile', userProfile);
};

/*
 * Adds a or updates a client.  Returns the modified ClientState object.
 */
GithubSocialProvider.prototype.addOrUpdateClient_ =
    function(userId, clientId, status) {
  var clientState = {
    userId: userId,
    clientId: clientId,
    status: status,
    lastUpdated: Date.now(),
    lastSeen: Date.now()
  };

  this.clientStates_[clientId] = clientState;
  this.dispatchEvent_('onClientState', clientState);
  return clientState;
};

/*
 * Handles new messages and information about clients.
 */
GithubSocialProvider.prototype.handleMessage_ =
    function(clientState, message) {
  this.dispatchEvent_(
      'onMessage', {from: clientState, message: message});
};


// Register provider when in a module context.
if (typeof freedom !== 'undefined') {
  if (!freedom.social2) {
    freedom().providePromises(GithubSocialProvider);
  } else {
    freedom.social2().providePromises(GithubSocialProvider);
  }
}

