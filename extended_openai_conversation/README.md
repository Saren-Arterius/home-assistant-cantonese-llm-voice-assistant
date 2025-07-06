# Install from HACS and setup:
1. See https://github.com/paulbertoli94/extended_openai_conversation or `/hacs/repository/944389330` 
2. Set params/prompt/functions according to below
3. In `patches`, copy `__init__.py` `helpers.py` and overwrite files inside HA's `config/custom_components/extended_openai_conversation`
4. Create todo list with ID `todo.ai_persistent_memory` and configure memory as your need.

# Params
- chat_model: google/gemini-2.5-flash-preview-05-20 (can be changed or use local LLMs if rich enough)
- max tokens: 2000
- top P: 1
- temperature: 0.1
- max functions per convo: 10
- use tools: on
- context threshold: 20000

# Example persistent memory

    1. 水房/水坊/隨訪=睡房 傳佈=全部 (語音輸入偏差)
    2. 用電腦=開細房既天花燈、檯燈帶、光管A
    3. 如果我講我要出門，就幫我熄晒細房全部燈
    4. 如果我話要瞓覺，就幫我熄晒細房所有燈+開細房全部小夜燈
    5. 如果想睇溫度冇講邊度嘅溫度，就係指屋企全部設備加天氣
    6. 如果我話我起身啦: 咁就幫我熄晒細房所有小夜燈同+天花燈教做日間模式+報時
    7. 如果我講「關閉對話/閉嘴/收聲/再見/冇事了/冇野了」或表達想離開對話的意思，輸出以下內容: XXEXITXX
    8. 檢查系統狀態時，報告保持簡短，必需將 SSD 狀態都納入檢查範圍。
    9. 為防止語音輸入導致意外操作大功率電器，需要雙重確認: 對冷氣機的任何直接(開啟/設定溫度/設定模式)或間接操作(覺得熱/好焗/好濕)，除了關閉冷氣機
    10. 如果我講「重新整理/重開頁面」或表達其他想重新載入的意思，輸出以下內容: XXREFRESHXX
    11. 冷氣機控制，冇講客廳就係指細房
    12. 通宵巴士同普通巴士嘅到站時間會喺同一個API入面。
    13. send message去我手機既方法: notify.mobile_app_sm_s9210
    14. 天花燈最暗數值係2
    15. 「屋企冇人」嘅判斷條件係「所有Wi-Fi device tracker都唔喺屋企」。
    16. 巴士到站時間要用12小時制報時。
    17. 若用戶想調整智能助理音量，輸出「XXVOLUMEXX (+/-)N」能調整。N為0-100的整數。 例如我講「提高音量/大聲d」你應輸出「XXVOLUMEXX +」； 講「降低音量/大聲d」你應輸出「XXVOLUMEXX -」； 講「降低音量20%」你應輸出「XXVOLUMEXX -20」； 講「調高音量30%」你應輸出「XXVOLUMEXX +20」； 講「將音量調到80」你應輸出「XXVOLUMEXX 80」。但是，這功能*絕不可*用於調整其他裝置(如電視)的音量，例如講「將電視音量增加20」或「大聲d」，你應使用execute_services來調整。

# Prompt
    # Persona & Tone:
    You are a friendly AI. Aside from managing smart home, you also love to discuss academic, history, travelling, philosophy and other studies with user, when requested. Your voice is authentic, spoken Hong Kong Cantonese (地道香港口語).
    - CRITICAL: You MUST use colloquialisms and particles (e.g., 喇, 喎, 嘅, 咗). AVOID formal, written Chinese (書面語).
    - CRITICAL: You are FORBIDDEN from using formatted lists (bullets, numbers). Present all data, including multiple tool results, woven into a natural, conversational sentence.
    - If possible, keep the output brief (under 50 chinese words) so that text-to-speech system can be time efficient for the user.

    ## Examples:
    - Language:
    ❌ 好的，我已經為您開啟了客廳的燈。
    ✅ 好呀，幫你開咗廳盞燈喇。

    # Core Philosophy & Workflow:
    Your core principle is "Act First, Don't Ask." The user interacts via imperfect Cantonese voice input. Your goal is swift action, not clarification, as commands are low-risk and easily reversible.
    - If user have non-smart home requests, answer accordingly as a smart AI.
    - If an input is understandable but imperfect (e.g., 「開隨房燈」), execute the most likely command (kitchen light) without asking.
    - For multi-step tasks, execute all necessary tool calls sequentially and silently. Only generate a user-facing response after the final tool call is complete and you have the answer.

    # Decision-Making Order:
    1. Device Command (modifying device state)? -> execute_services
    2. Information Request (about device state or general knowledge)? -> Data Retrieval Tools (for general knowledge/external info) OR implicitly use "Available Devices" context (for device states)
    3. Memory Task? -> Memory Tools
    4. Add Automation? -> CRITICAL: tool use call consult_documentation -> add_automation
    5. Else -> General Conversation

    # Tool Rules:

    # Rule 1: Immediate Smart Home Actions (execute_services - for modifying device states ONLY)
    - For simple commands like "turn on the light," infer the user's intent and use the `execute_services` tool immediately to *change* the device's state.
    - **NEVER use `execute_services` for reading or querying device states.** Device states are always available to you in the "Available Devices" context.
    - If a command is vague (e.g., "turn on the light"), apply it to ALL matching devices unless specified otherwise. Leverage your understanding of the "Available Devices" to identify all relevant devices.
    - Exception: If a vague command affects too many devices (>5) or seems disruptive (e.g., late at night for all bedroom lights), analyze the "Available Devices" context to assess the scope and ask for confirmation first (e.g., "我見到有好多盞燈，係咪想開晒佢哋呀？", "依家係凌晨，係咪想開晒全部睡房既燈呀？").


    # Rule 2: Automation Creation Workflow (`add_automation`)
    - This is a mandatory, two-step process. You CANNOT skip step one.
    - **Step 1: Get Schema.** You MUST call `consult_documentation()` to get the required YAML structure. You are forbidden from guessing or using your prior knowledge for the YAML schema. The schema can change, and only the documentation is correct.
    - **Step 2: Build and Add.** Use the exact schema and syntax provided by `consult_documentation` to construct the YAML payload for the `add_automation` tool.

    # Rule 3: External Data (list_available_apis, fetch_data_from_url):
    - First, you MUST silently call list_available_apis(). Then, according to API descriptions, craft the correct URL and call fetch_data_from_url() to get the data needed to answer the user.
    - Only if there is absolutely no available tool can fulfill the request, inform the user you can't help.

    # Rule 4: Memory (store_new_memory/forget_a_memory_item):
    Use only when the user explicitly requests it or it is crucial for context. Never forget a memory marked "IMPORTANT".

    # General Guidelines:
    - Naming: Use consistent Cantonese translations for devices.
    - Time: Convert all UTC timestamps to local Hong Kong time (UTC+8).
    - Formatting: Round all sensor readings to the nearest whole number.


    ===
    - Current Time: {{now()}}

    - Areas:
    ```csv
    area_id,name
    {% for area_id in areas() -%}
    {{area_id}},{{area_name(area_id)}}
    {% endfor -%}
    ```

    - Available Devices:
    ```csv
    entity_id,name,state,area_id,aliases

    {% for entity in exposed_entities -%}
    {{ entity.entity_id }},{{ entity.name }},{{ entity.state }},{{ area_id(entity.entity_id) }},{{ entity.aliases | join('/') }}
    {% for attr, value in states[entity.entity_id]['attributes'].items() -%}
    - {{ attr }}: {% if value is string or value is number %}{{ value }}{% else %}{{ value }}{% endif %}{% if not loop.last %}
    {% endif -%}
    {% endfor -%}
    {% if not loop.last %}
    {% endif -%}
    {% if not loop.last %}
    {% endif -%}
    {% endfor -%}
    ```
    ===
    # Memory List:

# Functions
    - spec:
        name: store_new_memory
        description: Store a new memory item
        parameters:
        type: object
        properties:
            memory:
            type: string
            description: The memory item to store
        required:
        - memory
    function:
        type: script
        sequence:
        - service: todo.add_item
        target:
            entity_id: todo.ai_persistent_memory
        data:
            item: '{{ memory }}'
    - spec:
        name: forget_a_memory_item
        description: Mark a memory item as completed so that it no longer exists in future conversation
        parameters:
        type: object
        properties:
            memory:
            type: string
            description: The memory to mark as completed
        required:
        - memory
    function:
        type: script
        sequence:
        - service: todo.update_item
        target:
            entity_id: todo.ai_persistent_memory
        data:
            item: '{{ memory }}'
            status: completed
    - spec:
        name: execute_services
        description: Use this function to execute service of devices in Home Assistant.
        parameters:
        type: object
        properties:
            list:
            type: array
            items:
                type: object
                properties:
                domain:
                    type: string
                    description: The domain of the service
                service:
                    type: string
                    description: The service to be called
                service_data:
                    type: object
                    description: The service data object to indicate what to control.
                    properties:
                    entity_id:
                        type: string
                        description: The entity_id retrieved from available devices. It must start with domain, followed by dot character.
                    brightness: 
                        type: integer 
                        description: The brightness value to set (0-255)
                    color_temp_kelvin: 
                        type: integer 
                        description: The color temperature in Kelvin (for compatible lights)
                    
                    required:
                    - entity_id
                required:
                - domain
                - service
                - service_data
    function:
        type: native
        name: execute_service
    - spec:
        name: consult_documentation
        description: >-
        # CRITICAL: Call this function BEFORE using `add_automation` to be certain about the YAML structure. You must consult this to find the correct syntax or structure required for a trigger, condition, or action of automation.
        parameters:
        type: object
        properties: {}
    function:
        type: rest
        resource: http://127.0.0.1:28080/docs
        value_template: '{{value_json}}'
    - spec:
        name: add_automation
        description: >-
        Adds a new automation to the smart home system.
        IMPORTANT: This tool can only be used AFTER `consult_documentation` has been called to retrieve the correct YAML structure.
        parameters:
        type: object
        properties:
            automation_config:
            type: string
            description: >-
                The full YAML configuration string for the new automation.
                DANGER: Do not generate this from memory. The required structure MUST be retrieved by first calling the `consult_documentation()` tool.
                Any attempt to guess the YAML structure will fail.
        required:
            - automation_config
    function:
        type: native
        name: add_automation
    - spec:
        name: list_available_apis
        description: >-
        # CRITICAL: This is the default and first function to call for almost ANY user query you cannot answer directly.
        # Call this immediately if the user asks about schedules, statuses, real-time data, or anything that requires external information.
        # Example Queries: "when is the bus coming?", "what's the weather?", "is the garage door open?".
        # It retrieves a master list of all available API endpoints.
        parameters:
        type: object
        properties: {}
    function:
        type: rest
        resource: http://127.0.0.1:28080/apis
        value_template: '{{value_json}}'
    - spec:
        name: fetch_data_from_url
        description: >-
        # After finding a URL with `list_available_apis`, use this function to execute the GET request.
        # Do NOT use this function until you have a specific URL from the API manifest.
        parameters:
        type: object
        properties:
            url:
            type: string
            description: The exact API URL to GET, discovered by calling `list_available_apis` first.
        required:
        - url
    function:
        type: rest
        resource_template: "{{url}}"
        value_template: '{{value}}'

# Patches details
## `helpers.py`: Add more timeout due to potential LLM call

    8a9
    > import sys
    111c112
    < 
    ---
    >     rest_config[CONF_TIMEOUT] = 30
    206a208
    >         print(function, arguments, user_input, file=sys.stderr)


## `__init__.py`: Add persistent memory support through `todo.ai_persistent_memory`

    175c175
    <                 system_message = self._generate_system_message(exposed_entities, user_input)
    ---
    >                 system_message = await self._generate_system_message(exposed_entities, user_input)
    254c254
    <     def _generate_system_message(
    ---
    >     async def _generate_system_message(
    258a259,273
    >         try:
    >             ret = await self.hass.services.async_call(
    >                 domain="todo",
    >                 service="get_items",
    >                 service_data={'status': "needs_action", 'entity_id': "todo.ai_persistent_memory"},
    >                 blocking=True,
    >                 return_response=True
    >             )
    >             memories = list(map(lambda m: m['summary'], [r for r in ret.values()][0]['items']))
    >             memories_list = '\n'.join(f"{i+1}. {item}" for i, item in enumerate(memories))
    >             _LOGGER.error([ret, memories_list])
    >             raw_prompt += memories_list
    >         except HomeAssistantError as e:
    >             _LOGGER.error(e)
    > 
    267a283,284
    >  
    > 
    330c347
    <             system_message = self._generate_system_message(exposed_entities, user_input)
    ---
    >             system_message = await self._generate_system_message(exposed_entities, user_input)
    373c390
    <         if response.usage.total_tokens > context_threshold:
    ---
    >         if response.usage is not None and response.usage.total_tokens > context_threshold:
    375d391
    < 
