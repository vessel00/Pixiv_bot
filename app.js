const { Telegraf, Markup } = require('telegraf')
const { telegrafThrottler } = require('telegraf-throttler')
const exec = require('util').promisify((require('child_process')).exec)
let config = require('./config.json')
const {
    asyncForEach,
    handle_illust,
    handle_ranking,
    handle_novel,
    get_pixiv_ids,
    get_user_illusts,
    ugoira_to_mp4,
    download_file,
    catchily,
    _l,
    k_os,
    mg_create, mg_albumize,mg_filter,
    mg2telegraph,
} = require('./handlers')
const db = require('./db')
const throttler = telegrafThrottler({
    group: {
        minTime: 500
    },
    in: {
        highWater: 100,
        minTime: 500
    },
    out: {
        highWater: 100,
        minTime: 500
    },
    onThrottlerError: (error) => {
        console.warn(error)
    }
})
const bot = new Telegraf(config.tg.token)
bot.use(throttler)
bot.use(async (ctx, next) => {
    // simple i18n
    ctx.l = (!ctx.from || !ctx.from.language_code) ? 'en' : ctx.from.language_code
    try {
        let text = ''
        if (ctx.message && ctx.message.text)
            text = ctx.message.text
        if (ctx.inlineQuery && ctx.inlineQuery.query)
            text = ctx.inlineQuery.query
        // remove command[@username] : /start@pixiv_bot -> /start
        ctx.rtext = text.replaceAll('@' + ctx.botInfo.username, '')
    } catch (error) {
        ctx.rtext = ''
    }
    // db
    ctx.db = {}
    ctx.flag = {
        setting: {
            // I don't wanna save the 'string' data in default (maybe the format will be changed in the future)
            // see telegram/fotmat.js to get real data
            format: {
                message: false,
                mediagroup_message: false,
                inline: false
            },
            default: {
                open: true,
                share: true,
                album: true
            },
            dbless: true, // the user isn't in chat_setting
        }
    }
    ctx.temp_data = {
        mg: []
    }
    let s_col = await db.collection('chat_setting')
    if (ctx.from) {
        let setting = await s_col.findOne({
            id: ctx.from.id
        })
        if(setting){
            ctx.flag.setting = setting
            ctx.flag.setting.dbless = false
            delete ctx.flag.setting._id
            delete ctx.flag.setting.id
        }
    }
    if (process.env.dev) {
        console.log('input ->', ctx.rtext,ctx.flag)
    }
    next()
})
bot.use(async (ctx, next) => {
    // default flag -> d_f
    let d_f = ctx.flag.setting.default ? ctx.flag.setting.default : {}
    ctx.flag = {
        ...ctx.flag,
        // caption start
        tags: (d_f.tags && !ctx.rtext.includes('-tag')) || ctx.rtext.includes('+tag'),
        open: (d_f.open && !ctx.rtext.includes('-open')) || ctx.rtext.includes('+open'),
        share: (d_f.share && !ctx.rtext.includes('-share')) || ctx.rtext.includes('+share'),
        remove_keyboard: (d_f.remove_keyboard && !ctx.rtext.includes('+kb')) || ctx.rtext.includes('-kb'),
        remove_caption: (d_f.remove_caption && !ctx.rtext.includes('+cp')) || ctx.rtext.includes('-cp'),
        single_caption: !ctx.inlineQuery && (d_f.single_caption && !ctx.rtext.includes('-sc')) || ctx.rtext.includes('+sc'),

        show_id: !ctx.rtext.includes('-id'),
        // caption end
        // send all illusts as mediagroup
        album: (d_f.album && !ctx.rtext.includes('-album')) || ctx.rtext.includes('+album'),
        
        // descending order
        desc: (d_f.desc && !ctx.rtext.includes('-desc')) || ctx.rtext.includes('+desc'),


        // send as telegraph
        telegraph: ctx.rtext.includes('+graph') || ctx.rtext.includes('+telegraph'),
        // send as file
        asfile: ctx.rtext.includes('+file'),
        q_id: 0 // telegraph albumized value
    }
    if (ctx.flag.telegraph) {
        ctx.flag.album = true
        ctx.flag.tags = true
    }
    if (ctx.flag.single_caption) {
        ctx.flag.album = true
    }
    let otext = ctx.rtext
    // replace text
    ctx.rtext = ctx.rtext
        .replaceAll('+tags', '').replaceAll('+tag', '').replaceAll('-tags', '').replaceAll('-tag', '')
        .replaceAll('+telegraph', '').replaceAll('+graph', '')
        .replaceAll('+album', '').replaceAll('-album', '')
        .replaceAll('+open', '').replaceAll('-open', '')
        .replaceAll('+share', '').replaceAll('-share', '')
        .replaceAll('+caption', '').replaceAll('-caption', '').replaceAll('+cp', '').replaceAll('-cp', '')
        .replaceAll('+keyboard', '').replaceAll('-keyboard', '').replaceAll('+kb', '').replaceAll('-kb', '')
        .replaceAll('+desc', '').replaceAll('-desc', '')
        .replaceAll('+sc', '').replaceAll('-sc', '')
        .replaceAll('-id', '')
        .replaceAll('+file', '')

    if (ctx.rtext.includes('+rm')) {
        ctx.flag.remove_caption = ctx.flag.remove_keyboard = false
        ctx.rtext = ctx.rtext.replaceAll('+rm', '')
    }
    if (ctx.rtext.includes('-rm')) {
        ctx.flag.remove_caption = ctx.flag.remove_keyboard = true
        ctx.rtext = ctx.rtext.replaceAll('-rm', '')
    }
    if(ctx.flag.remove_keyboard){
        ctx.flag.open = ctx.flag.share = false
    }
    // only support user
    if(otext== '/s'){
        // lazy....
            ctx.flag.setting = {
                format: {
                    message: ctx.flag.setting.format.message ? ctx.flag.setting.format.message : '%NSFW|#NSFW %[%title%](%url%)% / [%author_name%](%author_url%)% |p%%\n|tags%',
                    mediagroup_message: ctx.flag.setting.format.mediagroup_message ? ctx.flag.setting.format.mediagroup_message : '%[%mid% %title%% |p%%](%url%)%\n|tags%',
                    inline: ctx.flag.setting.format.inline ? ctx.flag.setting.format.inline : '%NSFW|#NSFW %[%title%](%url%)% / [%author_name%](%author_url%)% |p%%\n|tags%'
                },
                default: ctx.flag.setting.default
        }
        // alert who open old config (based on configuration generate time)
        ctx.flag.setting.time = +new Date()
        delete ctx.flag.setting.dbless
        await ctx.reply(_l(ctx.l, 'setting_open_link'), {
            ...Markup.inlineKeyboard([
                Markup.button.url('open', `https://pixiv-bot.pages.dev/${_l(ctx.l)}/s#${Buffer.from(JSON.stringify(ctx.flag.setting), 'utf8').toString('base64')}`.replace('/en', ''))
            ])
        })
        return
    }
    if((otext.substr(0,3) == '/s ' || ctx.rtext.substr(0, 3) == 'eyJ') && ctx.chat.id > 0){
        if(otext == '/s reset'){
            await ctx.reply(_l(ctx.l, 'setting_reset'))
            await db.delete_setting(ctx.chat.id)
        }
        let new_setting = {}
        if(otext.length > 2 && (otext.includes('+') || otext.includes('-'))){
            new_setting = {
                default: ctx.flag
            }
        }else if(ctx.rtext.substr(0, 3) == 'eyJ'){
            try {
                new_setting = JSON.parse(Buffer.from(ctx.rtext, 'base64').toString('utf8'))
            } catch (error) {
                // message type is doesn't base64
                await ctx.reply(_l(ctx.l, 'error'))
                console.warn(ctx,rtext,error)
            }
        }
        if(JSON.stringify(new_setting).length > 2){
            if(await db.update_setting(new_setting, ctx.from.id, ctx.flag)){
                await ctx.reply(_l(ctx.l, 'setting_saved'),{
                    reply_to_message_id: ctx.message.message_id,
                    allow_sending_without_reply: true
                })
            } else {
                await ctx.reply(_l(ctx.l, 'error'))
            }
        }
        return
    }
    await next()
})
bot.start(async (ctx, next) => {
    // startPayload = deeplink 
    // see more https://core.telegram.org/bots#deep-linking
    if (ctx.startPayload) {
        // callback to bot.on function
        await next()
    } else {
        // reply start help command
        await ctx.reply(_l(ctx.l, 'start', ctx.message.message_id))
    }
})
bot.help(async (ctx, next) => {
    await ctx.reply('https://pixiv-bot.pages.dev')
})
bot.on('text', async (ctx, next) => {
    let timer_type = []
    let f_timer = () => {
        timer_type = timer_type.filter((v,i,s)=>{
            return s.indexOf(v) == i
        })
        if(timer_type.includes('video')){
            ctx.replyWithChatAction('upload_video')
        }
        if(timer_type.includes('photo')){
            ctx.replyWithChatAction('upload_photo')
        }
        if(timer_type.includes('document')){
            ctx.replyWithChatAction('upload_document')
        }
        if(timer_type.includes('typing')){
            ctx.replyWithChatAction('typing')
        }
    }
    let timer = setInterval(f_timer, 2000)
    setTimeout(() => {
        clearInterval(timer)
    }, 30000)
    let default_extra = {
        parse_mode: 'MarkdownV2',
        reply_to_message_id: ctx.message.message_id,
        allow_sending_without_reply: true
    }
    let ids = false
    let illusts = []
    if(a = get_pixiv_ids(ctx.rtext, 'user')){
        timer_type[3] = 'typing'
        if(a.length > 0 && ctx.from.id == config.tg.master_id){
            await asyncForEach(a,async id=>{
                illusts = await get_user_illusts(id)
                console.log(illusts)
            })
        }
        timer_type[3] = ''
    }
    if (b = get_pixiv_ids(ctx.rtext)) {
        if(b.length > 0){
            illusts = [...illusts,...b]
        }
    }
    if(ctx.flag.desc){
        illusts = illusts.reverse()
    }
    if(illusts.length > 0){
        await asyncForEach(illusts, async id => {
            let d = await handle_illust(id, ctx.flag)
            if (d == 404) {
                if (ctx.chat.id > 0){
                    await ctx.reply(_l(ctx.l, 'illust_404'),{...default_extra,parse_mode: 'Markdown'})
                    return
                }
            }
            ctx.flag.q_id += 1
            let mg = mg_create(d, ctx.flag)
            // send as file
            if (ctx.flag.asfile) {
                timer_type[2] = 'document'
                await asyncForEach(mg,async (o)=>{
                    let extra = {
                        ...default_extra,
                        caption: o.caption.replace('%mid%','').trim()
                    }
                    await ctx.replyWithDocument(o.media_o,extra).catch(async e=>{
                        if(catchily(e,ctx)){
                            if(d.type <= 2){
                                await ctx.replyWithDocument({source: await download_file(o.media_o)},extra).catch(e=>{
                                    if(catchily(e,ctx)){
                                        ctx.reply(_l(ctx.l, 'file_too_large',o.media_o.replace('i-cf.pximg.net',config.pixiv.pximgproxy)),default_extra)
                                    }
                                })
                            }else{
                                ctx.reply(_l(ctx.l, 'error'), default_extra)
                            }
                        }
                    })
                })
                timer_type[2] = ''
            } else {
                if(d.type <= 1) timer_type[0] = 'photo'
                if(d.type == 2) timer_type[1] = 'video'
                if (ctx.flag.album && (mg.length > 1 || (mg.length == 1 && illusts.length > 1))) {
                    ctx.temp_data.mg = [...ctx.temp_data.mg, ...mg]
                } else {
                    let extra = {
                        ...default_extra,
                        caption: mg[0].caption.replaceAll('%mid%','').trim(),
                        ...k_os(d.id, ctx.flag)
                    }
                    if (d.type <= 1) {
                        if (mg.length == 1) {
                            // mediagroup doesn't support inline keyboard.
                            if(mg.media_t){
                                await ctx.replyWithPhoto(mg[0].media_t,extra).catch(async e=>{
                                    await catchily(e,ctx)
                                })
                            } else {
                                await ctx.replyWithPhoto(mg[0].media_o,extra).catch(async e=>{
                                    if(await catchily(e,ctx)){
                                        await ctx.replyWithPhoto(await download_file(mg[0].media_o),extra).catch(async e=>{
                                            await ctx.replyWithPhoto(mg[0].media_r,extra).catch(async e=>{
                                                await ctx.replyWithPhoto(await download_file(mg[0].media_r),extra).catch(async e=>{
                                                    if(await catchily(e,ctx)){
                                                        ctx.reply(_l(ctx.l, 'error'),default_extra)
                                                    }
                                                })
                                            })
                                        })
                                    }
                                })
                            }
                        } else {
                            ctx.temp_data.mg = [...ctx.temp_data.mg, ...mg_albumize(mg)]
                        }
                    } else if (d.type == 2) {
                        let media = mg.media_t
                        if (!media) {
                            await ugoira_to_mp4(d.id)
                            media = {
                                source: `./tmp/mp4_1/${d.id}.mp4`
                            }
                        }
                        await ctx.replyWithAnimation(media,extra).then(async data=>{
                            // save ugoira file_id and next time bot can reply without send file
                            if (!d.tg_file_id && data.document) {
                                let col = await db.collection('illust')
                                col.updateOne({
                                    id: d.id.toString()
                                }, {
                                    $set: {
                                        tg_file_id: data.document.file_id
                                    }
                                })
                            }
                        }).catch(e => {
                            if(catchily(e,ctx)){
                                ctx.reply(_l(ctx.l, 'error'),default_extra)
                            }
                        })
                    }
                }
            }
        })
        if(ctx.temp_data.mg.length == 0){
            return
        }
        if(ctx.flag.asfile){

        }else if (ctx.flag.telegraph) {
            try {
                let res_data = await mg2telegraph(ctx.temp_data.mg)
                if (res_data) {
                    await asyncForEach(res_data, async (d) => {
                        await ctx.reply(d.ids.join('\n') + '\n' + d.url)
                    })
                    await ctx.reply(_l(ctx.l, 'telegraph_iv'))
                }
            } catch (error) {
                console.warn(error)
            }
        } else {
            if (ctx.flag.album) {
                ctx.temp_data.mg = mg_albumize(ctx.temp_data.mg, ctx.flag.single_caption)
            }
            if (ctx.temp_data.mg.length > 0) {
                await asyncForEach(ctx.temp_data.mg, async (mg, id) => {
                    await ctx.replyWithMediaGroup(await mg_filter([...mg])).catch(async e => {
                        if(catchily(e,ctx)){
                            await ctx.replyWithMediaGroup(await mg_filter([...mg],'dlo')).catch(async e => {
                                await ctx.replyWithMediaGroup(await mg_filter([...mg],'r')).catch(async e => {
                                    await ctx.replyWithMediaGroup(await mg_filter([...mg],'dlr')).catch(async e => {
                                        await catchily(e,ctx)
                                        await ctx.reply(_l(ctx.l, 'error'))
                                    })
                                })
                            })
                        }
                    })
                })
            }
            timer_type = []
        }
        timer_type = []
    }
    if (ids = get_pixiv_ids(ctx.rtext, 'novel')) {
        try {
            await asyncForEach(ids, async id => {
                let d = await handle_novel(id)
                if (d) {
                    await ctx.reply(`${d.telegraph_url}`)
                }
            })
        } catch (error) {
            console.warn(error)
        }
    }
    if (ctx.rtext.includes('fanbox.cc/') && ctx.chat.id > 0) {
        await ctx.reply(_l(ctx.l, 'fanbox_not_support'))
    }
})
bot.on('inline_query', async (ctx) => {
    let res = []
    let { offset } = ctx.inlineQuery
    if (!offset)
        offset = 0 // offset == empty -> offset = 0
    let query = ctx.rtext
    // offset = page
    offset = parseInt(offset)
    let res_options = {
        cache_time: 20, // maybe update format
        is_personal: ctx.flag.setting.dbless ? false : true // personal result
    }
    if (ids = get_pixiv_ids(query)) {
        await asyncForEach(ids.reverse(), async id => {
            let d = await handle_illust(id, ctx.flag)
            // 动图目前还是要私聊机器人生成
            if (d.type == 2 && d.inline.length == 0) {
                // 这个时候就偷偷开始处理了 所以不加 await
                ugoira_to_mp4(d.id)
                await ctx.answerInlineQuery([], {
                    switch_pm_text: _l(ctx.l, 'pm_to_generate_ugoira'),
                    switch_pm_parameter: ids.join('-_-').toString(), // ref to handlers/telegram/get_pixiv_ids.js#L12
                    cache_time: 0
                }).catch(async e=>{
                    await catchily(e)
                })
                return true
            }
            res = d.inline.concat(res)
        })
        if (res.splice((offset + 1) * 20 - 1, 20))
            res_options.next_offset = offset + 1
        res = res.splice(offset * 20, 20)
    } else if (query.replace(/ /g, '') == '') {
        let data = await handle_ranking([offset], ctx.flag)
        res = data.data
        if (data.next_offset){
            res_options.next_offset = data.next_offset
        }
    }
    await ctx.answerInlineQuery(res, res_options).catch(async e=>{
        await catchily(e)
    })
})
bot.catch(async (e, ctx) => {
    catchily(e,ctx)
})
bot.launch().then(async () => {
    if (!process.env.DEPENDIONLESS && !process.env.dev) {
        try {
            await exec('which ffmpeg')
            await exec('which mp4fpsmod')
        } catch (error) {
            console.error('You must install ffmpeg and mp4fpsmod to enable ugoira to mp4 function', error)
            console.error('If you want to run but won\'t install ffmpeg and mp4fpsmod, please exec following command:')
            console.error('DEPENDIONLESS=1 node app.js')
            process.exit()
        }
    }
    console.log(new Date(), 'started!')
    bot.telegram.sendMessage(config.tg.master_id,`${new Date().toString()} started!`)
}).catch(e => {
    console.error('You are offline or bad bot token', e)
    process.exit()
})