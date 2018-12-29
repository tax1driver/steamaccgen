var request = require('request-promise')
var _ = require('underscore')
var stdin = process.openStdin()

var dictionary = "abcdefghijklmnoprstuwxyzABCDEFGHIJKLMNOPRSTUWXYZ"

var state = {
  input_needed: false,
  sessionID: 0,
  input: null,
}

var inbox = {
  token: null,
  email: null,
  id: null
}

stdin.addListener("data", function(data)
{
  if (state.input_needed)
    state.input = data.toString().trim()
})


function get_captcha() {
  return new Promise(function(rs, rj) {
    request.post('https://store.steampowered.com/join/refreshcaptcha', {
      form: {
        count: 10
      }
    }).then(function(body) {
      rs(JSON.parse(body).gid)
    }).catch(function(err) {
      rj(err)
    })
  });
}

function get_captcha_view_url(gid) {
  return 'https://store.steampowered.com/login/rendercaptcha?gid=' + gid
}

function start_creation_session(email, captchaGID) {
  return new Promise(function(rs, rj) {
    request.post('https://store.steampowered.com/join/ajaxverifyemail', {
      form: {
        email: email,
        captchagid: captchaGID,
        captcha_text: state.input,
      }
    }).then(function(body) {
      var bodyParsed = JSON.parse(body)

      if (bodyParsed.success != 1) {
        rj({
          name: "CreateSessionFailed",
          message: 'Error code: ' + bodyParsed.success + " ,msg: " + bodyParsed.details
        })
      } else rs(bodyParsed.sessionid)
    }).catch(function(err) {
      return rj(err)
    })
  })
}

function finish_account_creation(account_name, password) {
  return new Promise(function(rs, rj) {
    request.post('https://store.steampowered.com/join/createaccount', {
      form: {
        count: 10,
        lt: 0,
        accountname: account_name,
        password: password,
        creation_sessionid: state.sessionID
      },
      headers: {
        "User-Agent" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36"
      }
    }).then(function(body) {
      var bodyParsed = JSON.parse(body)

      if (!bodyParsed.bSuccess) {
        rj({
          name: "AccountCreationFailed",
          message: bodyParsed.details,
          full_msg: bodyParsed,
          unparsed: body
        })
      } else rs()
    }).catch(function(err) {
      return rj(err)
    })
  })
}
function start_new_inbox_session() {
  return new Promise(function(rs, rj) {
    request.get('https://burner.kiwi/api/v1/inbox').then(function(body) {
      var result = JSON.parse(body)

      if (result.success == false) {
        return rj({
          name: "InboxCreationFailed",
          message: result.errors.msg
        })
      }

      inbox.token = result.result.token
      inbox.email = result.result.email.address
      inbox.id = result.result.email.id

      return rs()
    }).catch(function(err) {
      return rj(err)
    })
  })
}

function fetch_emails() {
  return new Promise(function(rs, rj) {
    request.get('https://burner.kiwi/api/v1/inbox/' + inbox.id + '/messages', {
      headers: {
        "X-Burner-Key": inbox.token
      },
    }).then(function(body) {
      var result = JSON.parse(body)

      if (result.success == false) {
        return rj({
          name: "InboxCreationFailed",
          message: result.errors.msg
        })
      }

      return rs(result.result)
    }).catch(function(err) {
      return rj(err)
    })
  })
}

function get_random_number(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function generate_random_string(len) {
  return new Promise(function(rs, rj) {
    if (len <= 0) {
      rj({
        name: "RandomGenerationFailed",
        message: "len <= 0"
      });
    }

    var str = ""
    for (var i = 0; i < len; i++) {
      str += dictionary[get_random_number(0, dictionary.length)]
    }

    return rs(str)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function wait_for_input() {
  return new Promise(async function(rs, rj) {
    while (state.input == null) {
      await sleep(10)
      continue;
    }

    return rs()
  })
}

function steam_mail_received(mail) {
  var mail_regex = /(https:\/\/store.steampowered.com\/account\/newaccountverification\?stoken=[a-zA-Z0-9_-]*&amp;creationid=[a-zA-Z0-9_-]*)/;
  var regex_result = mail_regex.exec(mail.body_html)


  var url = regex_result[0].replace("&amp;", "&")

  console.log('Confirming email address...')
  var uname = null
  var pwd = null

  request.get(url).then(function(body) {
    return generate_random_string(10)
  }).then(function(str) {
    uname = str
    return generate_random_string(10)
  }).then(function(str) {
    pwd = str
    return finish_account_creation(uname, pwd)
  }).then(function() {
    console.log('Account created successfully!')
    console.log('\t\tUsername: ', uname)
    console.log('\t\tPassword: ', pwd)
  }).catch(function(err) {
    console.log(err)
  })
}

function check_for_steam_messages() {
  fetch_emails().then(function(emails) {
    var steam_mail = null

    _.each(emails, function(email) {
      if (email.sender == "noreply@steampowered.com") {
        steam_mail = email
      }
    })

    if (steam_mail != null ) {
      steam_mail_received(steam_mail)
    } else {
      setTimeout(check_for_steam_messages, 1000)
    }
  })
}

(function() {
  var c_gid = null;

  start_new_inbox_session().then(function() {
    return get_captcha()
  }).then(function(gid) {
    c_gid = gid
    console.log('Please solve the captcha: ' + get_captcha_view_url(gid))
    state.input_needed = true

    return wait_for_input()
  }).then(function() {
    return start_creation_session(inbox.email, c_gid)
  }).then(function(sessionID) {
    state.sessionID = sessionID
    check_for_steam_messages()
    console.log('Waiting for emails from Steam...')
  }).catch(function(err) {
    console.log(err)
  })
})()
