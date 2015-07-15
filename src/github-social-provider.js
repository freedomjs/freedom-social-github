/*
 * GitHub social provider
 */

var GithubSocialProvider = function(dispatchEvent) {
  this.dispatchEvent_ = dispatchEvent;
  this.networkName_ = 'github';
  // TODO: rename uproxyGistDescription.
  this.uproxyGistDescription_ = 'test';
  this.initLogger_('GithubSocialProvider');
  this.initState_();
  this.storage = freedom['core.storage']();
  this.access_token = '';
};

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
      var url ='https://github.com/login/oauth/authorize?client_id=98d31e7ceefe0518a093';
      return oauth.launchAuthFlow(url, stateObj).then(function(responseUrl) {
        return responseUrl.match(/code=([^&]+)/)[1];
      });
    }).then(function(code) {
      var xhr = freedom["core.xhr"]();
      xhr.open('POST', 'https://github.com/login/oauth/access_token?code=' + code +
                '&client_id=98d31e7ceefe0518a093' +
                '&client_secret=f77bf1477d4ade44d2dff674e2ff742ed540b3a1', true);
      xhr.on('onload', function() {
        console.log('xhr loaded');
        xhr.getResponseText().then(function(text) {
          this.access_token = text.match(/access_token=([^&]+)/)[1];
          xhr = new freedom["core.xhr"]();
          xhr.open('GET', 'https://api.github.com/user?access_token=' + this.access_token, true);
          xhr.on('onload', function() {
            xhr.getResponseText().then(function(text) {
              var user = JSON.parse(text);
              console.log(user);
              var clientState = {
                userId: user.login,
                clientId: 'myClientId',
                status: "ONLINE",
                lastUpdated: Date.now(),
                lastSeen: Date.now()
              };
              fulfillLogin(clientState);
              var profile = {
                userId: user.login,
                name: user.name,
                lastUpdated: Date.now(),
                url: user.url,
                imageData: user.avatar_url
              };
              this.addUserProfile_(profile);
            }.bind(this));
          }.bind(this));
          xhr.send();
        }.bind(this));
      }.bind(this));
      xhr.send();
    }.bind(this));
  }.bind(this));  // end of return new Promise
};

/*
 * Check if this user already has a public uProxy gist with their public
 * key in it.
 */
GithubSocialProvider.prototype.checkForUproxyGist_ = function(userId) {
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/users/' + userId + '/gists';
  xhr.open('GET', url);
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      var publicGists = JSON.parse(this.response);
      for (var i = 0; i < publicGists.length; i++) {
        if (publicGists[i].description === this.uproxyGistDescription_) {
          return fulfill(true);
        }
      }
      return fulfill(false);
    };
    xhr.send();
  });
};

/*
 * Create a public uProxy gist for this user with their public key in it.
 */
GithubSocialProvider.prototype.createUproxyGist_ = function() {
  console.log('trying to post new gist');
  var xhr = new XMLHttpRequest();
  var url = 'https://api.github.com/gists';
  xhr.open('POST', url);
  return new Promise(function(fulfill, reject) {
    // TODO: error checking
    xhr.onload = function() {
      fulfill(true);
    };
    xhr.send({
      "description": this.uproxyGistDescription_,
      "public": true,
      "files": {
        "file1.txt": {
          "content": "my key"
        }
      }
    });
  });
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
GithubSocialProvider.prototype.sendMessage = function(friend, message) {
  return Promise.resolve();
};

/*
 * Logs out of the social network.
 */
GithubSocialProvider.prototype.logout = function() {
  return Promise.resolve();
};

/*
 * Initialize state.
 */
GithubSocialProvider.prototype.initState_ = function() {
};

/*
 * Adds a UserProfile.
 */
GithubSocialProvider.prototype.addUserProfile_ = function(friend) {
  var userProfile = {
    userId: friend.userId,
    name: friend.name || '',
    lastUpdated: Date.now(),
    url: friend.url || '',
    imageData: friend.imageData || ''
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


/*
 * Returns a Promise which fulfills with an OAuth token.
 */
GithubSocialProvider.prototype.getOAuthToken_ = function() {
  return Promise.resolve('token');
};

// Register provider when in a module context.
if (typeof freedom !== 'undefined') {
  if (!freedom.social) {
    freedom().providePromises(GithubSocialProvider);
  } else {
    freedom.social().providePromises(GithubSocialProvider);
  }
}
